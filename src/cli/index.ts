#!/usr/bin/env node
/**
 * Spec section 9's command surface. Thin: argv parsing and terminal I/O only.
 * Section 6 rule 1 runs the other way — `core` never imports this.
 *
 * Exit codes (section 8):
 *   0  success, INCLUDING a run that skipped unreadable files — a skip is a
 *      reported outcome, not a failure, and making it non-zero would break
 *      every script the first time one note has bad permissions
 *   1  configuration or usage error
 *   2  unexpected internal error
 */

import { realpathSync } from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Core, ConfigError } from "../core/index.js";
import type { DueCard, SyncSummary } from "../core/index.js";
import { Store } from "../store/index.js";
import { configPath, initConfig, InitRefused } from "../host/config.js";
import type { FileConfig } from "../host/config.js";
import { OpenedNotes, resolveEditor } from "../host/editor.js";
import { isBusy } from "../host/errors.js";
import {
  COUNT_CAP,
  countText,
  deferralReason,
  interpretKey,
  summaryFields,
} from "../host/present.js";
import type { KeyAction } from "../host/present.js";
import { openQueue, owed, rated, scheduled, serve, setAside } from "../host/queue.js";
import type { Scheduled } from "../host/queue.js";
import { openCore as openCoreWith, readAppConfig } from "../host/open.js";

export { interpretKey };
export type { KeyAction };
import { openInEditor } from "./editor.js";
import {
  emptyCounts,
  renderAnswer,
  renderHeader,
  renderNote,
  renderPrompt,
  renderStaleNote,
  renderSummary,
} from "./render.js";
import { colorEnabled, columns, styler } from "./style.js";

export { LEGEND } from "./render.js";

const USAGE = `GeodeMD — spaced repetition over a directory of Markdown files

  geode init <path> [--force]   write the config file
  geode sync [--full] [--dry-run]
  geode review [-n N]           any key flips a card; o opens its note
  geode stats
  geode rebuild

  --full      re-read every file, ignoring the mtime cache
  --dry-run   report what would change; write nothing
  -n, --limit how many cards to review (default 50)
`;

interface Args {
  command: string | undefined;
  positional: string[];
  flags: Set<string>;
  limit: number | undefined;
}

export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Set<string>();
  let limit: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-n" || a === "--limit") {
      const v = Number(argv[++i]);
      if (Number.isFinite(v) && v > 0) limit = Math.floor(v);
      continue;
    }
    if (a.startsWith("--limit=")) {
      const v = Number(a.slice("--limit=".length));
      if (Number.isFinite(v) && v > 0) limit = Math.floor(v);
      continue;
    }
    if (a.startsWith("-")) {
      flags.add(a.replace(/^-+/, ""));
      continue;
    }
    positional.push(a);
  }
  return { command: positional[0], positional: positional.slice(1), flags, limit };
}

/**
 * One line of counts.
 *
 * WHICH counts are worth showing is `summaryFields` in `host` — the app asks
 * the same question and must get the same answer. What is left here is purely
 * how a terminal says it: commas between fields, and the `detail` fields
 * folded into parentheses after the one they break down, so the line reads
 * `10 files (9 unchanged, 1 read)` rather than as three equal counts.
 */
export function formatSummary(s: SyncSummary): string {
  const parts: string[] = [];
  for (const f of summaryFields(s)) {
    const text = `${f.value} ${f.label}`;
    if (f.detail && parts.length > 0) {
      const at = parts.length - 1;
      const prev = parts[at]!;
      // Open a parenthetical on the first detail, extend it on the next.
      parts[at] = prev.endsWith(")") ? `${prev.slice(0, -1)}, ${text})` : `${prev} (${text})`;
    } else {
      parts.push(text);
    }
  }
  return `${parts.join(", ")} — ${s.elapsedMs}ms`;
}

/**
 * Explain a deferral, because otherwise it looks like a failure.
 *
 * The explanation is `deferralReason` in `host` — the app needs it more than
 * the CLI does, since "3 cards found, 0 new" in a window reads as a bug with
 * no output to scroll back through. What the CLI adds is the half that does
 * not travel: telling someone to run `geode sync` again is right here and
 * wrong in a window with a Sync button in it.
 */
export function deferralNote(s: SyncSummary): string | null {
  const reason = deferralReason(s);
  return reason && `note: ${reason} Run \`geode sync\` again to pick them up.`;
}

/**
 * The CLI's "or fail" wrapper. `host` returns null for a missing config
 * because a first run is not an error there; here it is, because every command
 * that calls this wants to exit non-zero.
 */
async function openCore(): Promise<{ core: Core; store: Store; config: FileConfig }> {
  const file = configPath();
  const config = await readAppConfig(file);
  if (!config) {
    throw new ConfigError(`no config at ${file} — run \`geode init <path>\` first`);
  }
  return { ...openCoreWith(config), config };
}

/** Section 9's review loop. Requires a TTY; restores the terminal on any exit. */
async function reviewLoop(core: Core, config: FileConfig, limit: number): Promise<void> {
  if (!process.stdin.isTTY) {
    // A line-buffered fallback that half works is worse than a clear refusal,
    // and there is no use for scripted review.
    throw new ConfigError("review requires an interactive terminal");
  }

  await core.ingestLogs(new Date());
  const now = new Date();
  const queue = core.getDueCards(now, limit);
  // What the queue was drawn FROM, which is both halves of section 9's two
  // queries. `countDue` alone counts only cards with scheduling state, so a
  // first session — every card new — headed itself "2 of 0 due".
  const available = core.stats(now, COUNT_CAP);
  // A floor rather than a total when the due count stopped at the cap: the sum
  // of a capped count and an exact one is "at least this many".
  const total = countText(available.dueNow + available.newCards, available.capped);

  const s = styler(colorEnabled(process.env, Boolean(process.stdout.isTTY)));
  const width = columns(process.stdout);

  if (queue.length === 0) {
    process.stdout.write(`\n${renderNote("Nothing due.", s)}`);
    return;
  }
  process.stdout.write(renderHeader(queue.length, total, s));

  readline.emitKeypressEvents(process.stdin);
  const setRaw = (on: boolean): void => {
    if (process.stdin.isTTY) process.stdin.setRawMode(on);
    if (on) process.stdin.resume();
    else process.stdin.pause();
  };
  setRaw(true);

  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    setRaw(false);
  };
  // A process that dies in raw mode leaves echo off, which reads as a broken
  // shell rather than as a quit. Every rating already given is safe by the
  // log-first rule, so a clean exit is honest.
  //
  // While an editor holds the terminal, though, a Ctrl-C is aimed at *it*:
  // stdio is inherited, so the signal reaches this process as well, and acting
  // on it would end the session out from under the editor.
  let editorRunning = false;
  const onSigint = (): void => {
    if (editorRunning) return;
    restore();
    process.stdout.write("\n");
    process.exit(0);
  };
  process.on("SIGINT", onSigint);

  const key = async (): Promise<string> =>
    new Promise((resolve) => {
      const handler = (str: string, k: { name?: string; ctrl?: boolean }): void => {
        process.stdin.off("keypress", handler);
        if (k?.ctrl && k.name === "c") resolve("q");
        // Escape arrives as the raw `\x1b` byte in `str`, which is not what
        // `interpretKey` matches on — so it fell through to "any key reveals"
        // here while the app, which passes the DOM's `"Escape"`, quit. Passing
        // the NAME for this one key is what keeps both interfaces agreeing
        // about a key `host` already owns.
        else if (k?.name === "escape") resolve("escape");
        else resolve(str ?? k?.name ?? "");
      };
      process.stdin.on("keypress", handler);
    });

  /**
   * Notes opened this session, against the mtime each had when it was first
   * opened. The app keeps the same record for the same reason, which is why
   * this lives in `host` — see `OpenedNotes` for why the check is deferred to
   * the end of the session rather than made when the editor returns.
   */
  const openedNotes = new OpenedNotes(config.notesPath);

  /** Open the note this card was written in, then hand the terminal back. */
  const openContext = async (card: DueCard): Promise<string | null> => {
    const abs = path.join(config.notesPath, card.filePath);
    await openedNotes.opened(card.filePath);
    const editor = resolveEditor(config.editor, process.env);

    editorRunning = true;
    setRaw(false);
    try {
      return await openInEditor(abs, card.lineNo, editor);
    } finally {
      setRaw(true);
      editorRunning = false;
    }
  };

  const counts = emptyCounts();

  /**
   * Every exit path ends here. Editing a card would otherwise leave the
   * database quietly holding the old text until the next sync, with no sign
   * that it had.
   */
  const sessionEnd = async (): Promise<string> => {
    const changed = await openedNotes.changed();
    // Summary first: it carries the blank line that separates the session from
    // the last card, and the note that wants acting on then sits last, where
    // the eye lands.
    return renderSummary(counts, s) + renderStaleNote(changed, s);
  };

  try {
    /**
     * What the session still owes, and which card is next.
     *
     * Both the reordering `0` does and the re-showing a learning step asks for
     * live in `host/queue.ts` rather than in this loop, because the app needs
     * the identical rules and two copies would drift (ADR 0023). All that is
     * left here is asking what to show, and saying what happened.
     */
    let pending = openQueue(queue);
    let answered = 0;

    for (;;) {
      // Null means nothing to show. In this loop it also means nothing is
      // owed: every rating reports its outcome before the next card is asked
      // for, so no card is ever in flight at this line.
      const card = serve(pending, new Date());
      if (!card) break;
      // Answers given and answers owed, not a position in a fixed list: a card
      // on a learning step is owed a second one, so the total grows as those
      // are earned. `host/queue.ts` counts it.
      const prompt = renderPrompt(card, answered + 1, answered + owed(pending), s, width);
      const answer = renderAnswer(card, s, width);

      process.stdout.write(prompt);
      // Any key flips, but `q` still quits: a question you cannot escape from
      // without answering it is not what the legend promises.
      const first = interpretKey(await key());
      if (first.kind === "quit") {
        process.stdout.write(await sessionEnd());
        return;
      }
      if (first.kind === "defer") {
        // Nothing is recorded — not a rating, not a log line. The card is
        // simply owed an answer later in this session.
        pending = setAside(pending, card);
        continue;
      }
      process.stdout.write(answer);

      let rating: 1 | 2 | 3 | 4 | null = null;
      while (rating === null) {
        const action = interpretKey(await key());
        if (action.kind === "quit") {
          process.stdout.write(await sessionEnd());
          return;
        }
        if (action.kind === "open") {
          const failure = await openContext(card);
          // A terminal editor has scribbled over the card. Put it back, so the
          // rating is given against something still on screen — and put any
          // complaint about the editor *after* it, where the cursor is, rather
          // than above a full card render where it scrolls out of the eye.
          process.stdout.write(prompt);
          process.stdout.write(answer);
          if (failure !== null) process.stdout.write(renderNote(failure, s));
          continue;
        }
        if (action.kind === "rate") rating = action.rating;
      }

      pending = rated(pending, card);
      /**
       * The card's new state, and null when the write failed.
       *
       * This is what decides whether the card comes back in this sitting: FSRS
       * puts a new card rated anything but *easy* one to ten minutes out, and
       * the queue re-shows it when that time comes. A busy database costs the
       * re-show and not the review — the rating is already in the log.
       */
      let next: Scheduled | null = null;
      try {
        next = await core.reviewCard(card.id, rating, new Date());
      } catch (err) {
        // WAL allows one writer. By now the rating is already fsynced into the
        // log, so this is precisely the condition the next ingest repairs.
        if (isBusy(err)) {
          process.stdout.write(
            renderNote("database busy; reviews are in the log and will sync later", s),
          );
        } else {
          throw err;
        }
      }
      pending = scheduled(pending, card.id, next, new Date());
      counts[rating]++;
      answered++;
    }
    process.stdout.write(await sessionEnd());
  } finally {
    process.off("SIGINT", onSigint);
    restore();
  }
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (!args.command || args.flags.has("h") || args.flags.has("help")) {
    process.stdout.write(USAGE);
    return args.command ? 0 : 1;
  }

  switch (args.command) {
    case "init": {
      const target = args.positional[0];
      if (!target) {
        process.stderr.write("usage: geode init <path> [--force]\n");
        return 1;
      }
      const file = configPath();
      const config = await initConfig(file, target, { force: args.flags.has("force") });
      process.stdout.write(`wrote ${file}\n`);
      process.stdout.write(`  notes:  ${config.notesPath}\n`);
      process.stdout.write(`  device: ${config.device}\n`);
      process.stdout.write(`  db:     ${config.dbPath}\n\n`);
      // The first real sync stamps every file holding a card — much better
      // learned from a dry run than from a diff.
      process.stdout.write("Next: commit your notes if they are in version control,\n");
      process.stdout.write("then run `geode sync --dry-run` to see what would change.\n");
      return 0;
    }

    case "sync":
    case "rebuild": {
      const { core, store } = await openCore();
      try {
        const opts = {
          full: args.flags.has("full"),
          dryRun: args.flags.has("dry-run") || args.flags.has("dryrun"),
        };
        const summary =
          args.command === "rebuild"
            ? await core.rebuild(new Date(), opts)
            : await core.sync(new Date(), opts);
        if (opts.dryRun) process.stdout.write("dry run — nothing was written\n");
        process.stdout.write(`${formatSummary(summary)}\n`);
        const note = deferralNote(summary);
        if (note) process.stdout.write(`${note}\n`);
        return 0;
      } finally {
        store.close();
      }
    }

    case "review": {
      const { core, store, config } = await openCore();
      try {
        await reviewLoop(core, config, args.limit ?? 50);
        return 0;
      } finally {
        store.close();
      }
    }

    case "stats": {
      const { core, store } = await openCore();
      try {
        await core.ingestLogs(new Date());
        const s = core.stats(new Date(), COUNT_CAP);
        // `10000+` when a count stopped at the cap (ADR 0024). The wording is
        // host's, so `geode stats` and the app's Collection tab cannot disagree
        // about what a capped number looks like.
        process.stdout.write(`total:                ${s.total}\n`);
        process.stdout.write(`due now:              ${countText(s.dueNow)}\n`);
        process.stdout.write(`due before midnight:  ${countText(s.dueBeforeMidnight)}\n`);
        process.stdout.write(`new:                  ${countText(s.newCards)}\n`);
        return 0;
      } finally {
        store.close();
      }
    }

    default:
      process.stderr.write(`unknown command: ${args.command}\n\n${USAGE}`);
      return 1;
  }
}

/**
 * Is this module the process entry point?
 *
 * `process.argv[1]` is whatever path invoked us, which under `npm link` is a
 * symlink in a bin directory, while `import.meta.url` is always the resolved
 * file. Comparing them directly makes the installed binary a no-op — it exits 0
 * having done nothing — so both sides are resolved before comparing.
 */
export function isEntryPoint(metaUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

const isEntry = isEntryPoint(import.meta.url, process.argv[1]);

if (isEntry) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      if (err instanceof ConfigError || err instanceof InitRefused) {
        process.stderr.write(`${err.message}\n`);
        process.exit(1);
      }
      process.stderr.write(`unexpected error: ${String(err)}\n`);
      process.exit(2);
    });
}
