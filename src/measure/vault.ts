/**
 * Builds the collection `bench.ts` needs, because the question that bench
 * answers cannot be asked of a small one.
 *
 * Neither half of this harness sits under `src/electron/`, and that is the
 * boundary test's doing rather than taste: an interface may not import `files/`
 * — the rule that stops the app growing a second walk of the notes tree — and a
 * fixture generator legitimately needs to know where the log lives. The rule is
 * a text scan, so it cannot tell a harness from an app, and weakening it for a
 * script would cost more than moving the script.
 *
 * [ADR 0017](../../docs/decisions/0017-core-runs-in-the-main-process.md) put
 * `core` in the main process on a measurement taken at 20,000 cards and 8,000
 * reviews, and was explicit that the measurement does not extrapolate — the
 * design target is a million. A vault that size is not something to keep in the
 * repository, and generating one by hand is how a re-measurement quietly turns
 * into a different measurement, so it is a script.
 *
 *   node dist/measure/vault.js <dir> [cards] [reviews]
 *
 * Plain `node`, deliberately, not `electron`: this only has to *write* the
 * collection. Root `dist/` resolves the Node-ABI `better-sqlite3`, which is the
 * build a plain `node` can load (see `desktop/README.md`).
 *
 * What it produces, under `<dir>`:
 *
 *   notes/            the collection, stamped by a real sync
 *   notes/.sr/log/    review history, sharded per month like the real thing
 *   config.json       what to hand the bench as its last argument
 *   db.sqlite         the cache, already ingested
 *
 * **The log is built before the bench runs, and that is the point.** ADR 0017
 * records that an earlier run measured `rebuild` before anything had been
 * reviewed, which measured the cheap half of it: `rebuild` is `dropAll()` plus a
 * replay of every review ever given, and with no reviews there is nothing to
 * replay. The review count defaults to the same 0.4-per-card ratio the original
 * measurement had, so the two are comparable at different sizes.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { LOG_DIR, shardName } from "../files/index.js";
import type { LogLine } from "../files/index.js";
import { openCore } from "../host/open.js";
import type { FileConfig } from "../host/config.js";

/** Cards per note. Fifty is a dense but unremarkable note. */
const CARDS_PER_FILE = 50;
/** Files per directory, so the tree has the shape `enumerate` walks in practice. */
const FILES_PER_DIR = 100;

/**
 * Backdated, so the sync does not defer every file it just wrote.
 *
 * A file modified in the last couple of seconds is assumed to be open in an
 * editor and is left alone — which, for a collection written milliseconds ago,
 * is all of them. The same trap `src/core/sync.test.ts`'s `write` helper exists
 * to avoid.
 */
const MTIME = new Date("2026-01-01T00:00:00.000Z");

/** Ratings, weighted the way a real log is: mostly `good`. */
const RATINGS: Array<1 | 2 | 3 | 4> = [3, 3, 3, 3, 2, 4, 3, 1, 3, 2];

async function writeNotes(notes: string, cards: number): Promise<number> {
  const files = Math.ceil(cards / CARDS_PER_FILE);
  let written = 0;

  for (let d = 0; d * FILES_PER_DIR < files; d++) {
    const dir = path.join(notes, `topic-${String(d).padStart(4, "0")}`);
    await fs.mkdir(dir, { recursive: true });

    for (let f = 0; f < FILES_PER_DIR && d * FILES_PER_DIR + f < files; f++) {
      const n = d * FILES_PER_DIR + f;
      let body = `# Note ${n}\n\nSome prose, so the parser has lines to skip.\n\n`;
      for (let c = 0; c < CARDS_PER_FILE && written < cards; c++, written++) {
        body += `- What is fact ${n}-${c} :: The answer to fact ${n}-${c}\n`;
      }
      const abs = path.join(dir, `note-${String(f).padStart(3, "0")}.md`);
      await fs.writeFile(abs, body, "utf8");
      await fs.utimes(abs, MTIME, MTIME);
    }
  }
  return written;
}

/**
 * A log with `reviews` lines spread over the preceding six months.
 *
 * Written as whole shard files rather than through `appendLog`, which `fsync`s
 * every line: half a million of those is twenty minutes of waiting for
 * durability that a throwaway fixture does not need. The *format* is the real
 * one — `shardName` decides which file a line lands in, so the bench reads the
 * same layout an ingest meets in the wild.
 */
async function writeLog(
  notes: string,
  device: string,
  cardIds: readonly string[],
  reviews: number,
): Promise<{ lines: number; shards: number }> {
  const SPAN_DAYS = 180;
  const end = Date.now() - 24 * 3_600_000; // yesterday, so nothing is in the future
  const start = end - SPAN_DAYS * 24 * 3_600_000;

  const byShard = new Map<string, Array<{ at: string; json: string }>>();
  let lines = 0;

  // Time advances evenly across the span with `i`, and the cards are taken
  // round-robin — so a card reviewed three times has three reviews spread
  // months apart and in order, which is what an ingest actually folds.
  for (let i = 0; i < reviews; i++) {
    const card = cardIds[i % cardIds.length]!;
    const at = new Date(start + ((end - start) * i) / reviews).toISOString();

    const line: LogLine = { card, at, rating: RATINGS[i % RATINGS.length]! };
    const name = shardName(device, at);
    const entry = { at, json: JSON.stringify(line) };
    const bucket = byShard.get(name);
    if (bucket) bucket.push(entry);
    else byShard.set(name, [entry]);
    lines++;
  }

  const dir = path.join(notes, LOG_DIR);
  await fs.mkdir(dir, { recursive: true });
  for (const [name, bucket] of byShard) {
    // By `at`, as an append-only log necessarily is — NOT by the serialised
    // line, which begins with the card id and would order the file by nothing
    // in particular.
    bucket.sort((a, b) => a.at.localeCompare(b.at));
    const body = bucket.map((e) => e.json).join("\n");
    await fs.writeFile(path.join(dir, name), `${body}\n`, "utf8");
  }
  return { lines, shards: byShard.size };
}

function since(t: number): string {
  return `${((Date.now() - t) / 1000).toFixed(1)}s`;
}

async function main(): Promise<void> {
  const [dirArg, cardsArg, reviewsArg] = process.argv.slice(2);
  if (!dirArg) {
    process.stderr.write(
      "usage: node dist/measure/vault.js <dir> [cards] [reviews]\n" +
        "  cards   default 200000 — ten times ADR 0017's measurement\n" +
        "  reviews default cards * 0.4 — the ratio that measurement had\n",
    );
    process.exit(1);
  }

  const root = path.resolve(dirArg);
  const cards = Number(cardsArg ?? 200_000);
  const reviews = Number(reviewsArg ?? Math.round(cards * 0.4));
  if (!Number.isFinite(cards) || !Number.isFinite(reviews)) {
    process.stderr.write("cards and reviews must be numbers\n");
    process.exit(1);
  }

  const notes = path.join(root, "notes");
  const configFile = path.join(root, "config.json");
  const config: FileConfig = {
    notesPath: notes,
    device: "measure",
    dbPath: path.join(root, "db.sqlite"),
  };

  // Refuse to build on top of an existing one: a half-overwritten collection
  // would measure something nobody could describe afterwards.
  if (await fs.stat(root).catch(() => null)) {
    process.stderr.write(`${root} already exists — remove it or choose another path\n`);
    process.exit(1);
  }
  await fs.mkdir(notes, { recursive: true });
  await fs.writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  let t = Date.now();
  const written = await writeNotes(notes, cards);
  process.stdout.write(`  notes      ${written} cards in ${Math.ceil(written / CARDS_PER_FILE)} files — ${since(t)}\n`);

  const { core, store } = openCore(config);
  try {
    t = Date.now();
    const first = await core.sync(new Date());
    process.stdout.write(
      `  sync       ${first.cardsNew} cards stamped into ${first.filesStamped} files — ${since(t)}\n`,
    );

    // The ids come from the database rather than from the notes, because the
    // sync is what minted them. `getDueCards` is the only reader `core` exposes,
    // and every card is new at this point, so it returns them in note order.
    t = Date.now();
    const ids = core.getDueCards(new Date(), first.cardsNew).map((c) => c.id);
    process.stdout.write(`  ids        ${ids.length} — ${since(t)}\n`);

    t = Date.now();
    const log = await writeLog(notes, config.device, ids, reviews);
    process.stdout.write(`  log        ${log.lines} reviews in ${log.shards} shards — ${since(t)}\n`);

    // Ingest it now, so the collection handed to the bench is in the state a
    // real one is: history already replayed, cursor up to date.
    t = Date.now();
    const second = await core.ingestLogs(new Date());
    process.stdout.write(`  ingest     ${second.reviewsIngested} reviews replayed — ${since(t)}\n`);
  } finally {
    store.close();
  }

  process.stdout.write(`\n  measure it with:\n    npm --prefix desktop run measure -- ${configFile}\n\n`);
}

void main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
