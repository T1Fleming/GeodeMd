/**
 * Spec section 8 (sync) and section 9 (review flow). Orchestration; the public
 * API. Section 6's hard rules apply here:
 *   1. never imports `cli`
 *   2. returns data — never console.log, never process.exit, never prompts
 *   3. no ambient state: `now` and `newId` arrive in the config object
 *   5. long operations take onProgress rather than printing
 */

import { readFileSync } from "node:fs";
import { stat as statAsync } from "node:fs/promises";
import * as path from "node:path";
import * as files from "../files/index.js";
import { parse, splitLines, stampLine } from "../parser/index.js";
import type { ParsedCard } from "../parser/index.js";
import { Store } from "../store/index.js";
import type { CardState, DueRow } from "../store/index.js";
import { fold, FsrsScheduler } from "../scheduler/index.js";
import type { Scheduler } from "../scheduler/index.js";

export interface Config {
  notesPath: string;
  device: string;
  dbPath: string;
  /** Ambient dependencies, injected. Section 6 rule 3. */
  newId: () => string;
}

export interface SyncOptions {
  full?: boolean;
  dryRun?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface SyncSummary {
  filesEnumerated: number;
  filesUnchanged: number;
  filesRead: number;
  filesDeferred: number;
  cardsFound: number;
  cardsNew: number;
  cardsUpdated: number;
  cardsPruned: number;
  reconciled: boolean;
  duplicatesReminted: number;
  symlinkedDirsSkipped: number;
  logShardsSkipped: number;
  logBytesRead: number;
  reviewsIngested: number;
  filesSkippedOnError: number;
  logLinesSkipped: number;
  elapsedMs: number;
}

export interface DueCard {
  id: string;
  question: string;
  answer: string;
  /** "algorithms/Sorting.md:142" — relative to notesPath. Display only. */
  locator: string;
}

export class ConfigError extends Error {}

function emptySummary(): SyncSummary {
  return {
    filesEnumerated: 0,
    filesUnchanged: 0,
    filesRead: 0,
    filesDeferred: 0,
    cardsFound: 0,
    cardsNew: 0,
    cardsUpdated: 0,
    cardsPruned: 0,
    reconciled: false,
    duplicatesReminted: 0,
    symlinkedDirsSkipped: 0,
    logShardsSkipped: 0,
    logBytesRead: 0,
    reviewsIngested: 0,
    filesSkippedOnError: 0,
    logLinesSkipped: 0,
    elapsedMs: 0,
  };
}

/** Files whose mtime is this fresh are assumed open in an editor. */
const DEFER_WINDOW_MS = 2000;

export class Core {
  private readonly scheduler: Scheduler;

  constructor(
    private readonly config: Config,
    private readonly store: Store,
    scheduler?: Scheduler,
  ) {
    this.scheduler = scheduler ?? new FsrsScheduler();
  }

  // -- section 8 -----------------------------------------------------------

  async sync(now: Date, opts: SyncOptions = {}): Promise<SyncSummary> {
    const started = Date.now();
    const summary = emptySummary();
    const { notesPath } = this.config;
    const dryRun = opts.dryRun === true;

    // A notesPath that is missing or is not a directory is a CONFIGURATION
    // error: every count the run would report is meaningless, a silent
    // zero-card sync looks like success, and an empty directory would prune the
    // entire collection in step 6.
    await assertNotesDir(notesPath);

    // `known` is taken BEFORE the walk so that files inserted during this pass
    // cannot skew step 6's comparison.
    const known = this.store.countFiles();
    // Rows inserted during this pass get rowids above this mark. They were
    // necessarily seen, so step 6 ignores them rather than reading their
    // absence from the bitmap as a vanished file.
    const maxRowidBefore = this.store.maxFileRowid();
    const seen = new Uint8Array(Math.ceil((maxRowidBefore + 1) / 8) + 1);
    let hits = 0;

    // Step 1: enumerate. The seam.
    const { candidates, symlinkedDirs } = await files.enumerate(notesPath);
    summary.filesEnumerated = candidates.length;
    summary.symlinkedDirsSkipped = symlinkedDirs;

    // Ids seen anywhere in this pass, so a copy inside one file is caught even
    // when the second occurrence is in a file walked later.
    const idsSeenThisPass = new Set<string>();

    let done = 0;
    for (const cand of candidates) {
      done++;
      opts.onProgress?.(done, candidates.length);

      // Step 2: classify. One indexed read, no write.
      const row = this.store.getFile(cand.relPath);
      if (row) {
        hits++;
        if (row.rowid <= maxRowidBefore) seen[row.rowid >> 3]! |= 1 << (row.rowid & 7);
        if (!opts.full && row.mtime_ms === cand.mtimeMs && row.size === cand.size) {
          summary.filesUnchanged++;
          continue;
        }
      }

      // Step 3: read and parse.
      let text: string;
      try {
        text = await files.readFile(notesPath, cand.relPath);
      } catch {
        summary.filesSkippedOnError++;
        continue;
      }
      summary.filesRead++;

      const parsed = parse(text);
      summary.cardsFound += parsed.length;

      // Step 4: defer, mint, write.
      // "within 2 seconds of" is symmetric. A signed comparison would defer a
      // file whose mtime is in the future *forever* — clock skew, a restored
      // archive, or a bad timestamp would mean it is never stamped.
      const deferred = Math.abs(now.getTime() - cand.mtimeMs) < DEFER_WINDOW_MS;
      if (deferred) summary.filesDeferred++;

      const outcome = await this.stampFile({
        relPath: cand.relPath,
        text,
        parsed,
        stat: { mtimeMs: cand.mtimeMs, size: cand.size },
        deferred,
        dryRun,
        idsSeenThisPass,
        summary,
      });
      if (outcome === null) continue; // write guard fired; retry next pass

      // Step 5: reconcile.
      if (!dryRun) {
        this.reconcileFile(cand.relPath, outcome.confirmed, outcome.stat, summary);
      } else {
        for (const c of outcome.confirmed) {
          if (!this.store.getCard(c.id!)) summary.cardsNew++;
        }
      }
    }

    // Step 6: prune — and usually decide not to.
    if (hits < known) {
      summary.reconciled = true;
      if (!dryRun) {
        const vanished: string[] = [];
        for (const f of this.store.allFileRowids()) {
          if (f.rowid > maxRowidBefore) continue; // inserted this pass
          if ((seen[f.rowid >> 3]! & (1 << (f.rowid & 7))) === 0) vanished.push(f.path);
        }
        this.store.transaction(() => {
          for (const p of vanished) {
            summary.cardsPruned += this.store.cardIdsInFile(p).length;
          }
          this.store.deleteFiles(vanished);
        });
      }
    }

    // Step 7: ingest logs.
    if (!dryRun) {
      const ingest = await this.ingestLogs(now);
      summary.logShardsSkipped = ingest.shardsSkipped;
      summary.logBytesRead = ingest.bytesRead;
      summary.reviewsIngested = ingest.reviewsIngested;
      summary.logLinesSkipped = ingest.linesSkipped;
    }

    summary.elapsedMs = Date.now() - started;
    return summary;
  }

  /**
   * Step 4. Mint ids for unstamped lines and apply all stamps for the file in
   * ONE write, reconstructing the file from lines that each keep their own
   * terminator.
   *
   * Returns the cards whose id is now on disk and was written or confirmed this
   * pass — steps 4-5's invariant is that an id exists in the DB only if it
   * exists on disk. Returns null when the write guard fired.
   */
  private async stampFile(args: {
    relPath: string;
    text: string;
    parsed: ParsedCard[];
    stat: files.StatInfo;
    deferred: boolean;
    dryRun: boolean;
    idsSeenThisPass: Set<string>;
    summary: SyncSummary;
  }): Promise<{ confirmed: ParsedCard[]; stat: files.StatInfo } | null> {
    const { relPath, text, parsed, stat, deferred, dryRun, idsSeenThisPass, summary } = args;

    const lines = splitLines(text);
    const confirmed: ParsedCard[] = [];
    const toStamp: Array<{ card: ParsedCard; id: string }> = [];
    const seenInThisFile = new Set<string>();

    for (const card of parsed) {
      // Three ways an id on this line can turn out to belong to someone else.
      // The third is the one the incremental fast path makes necessary: when
      // the original file is unchanged it is never re-read, so a copy cannot be
      // detected by "seen earlier this pass" alone — the stored row has to be
      // consulted, and the old file read once to tell a copy from a move
      // (section 4). Doing this here rather than at reconcile time is what lets
      // the copy actually get a fresh id written to disk.
      let duplicate = false;
      if (card.id !== null) {
        if (seenInThisFile.has(card.id) || idsSeenThisPass.has(card.id)) {
          duplicate = true;
        } else {
          const existing = this.store.getCard(card.id);
          if (existing && existing.file_path !== relPath) {
            duplicate = idIsInFile(this.config.notesPath, existing.file_path, card.id);
          }
        }
      }

      if (card.id !== null && !duplicate) {
        // Already stamped on disk, first occurrence: confirmed as-is.
        seenInThisFile.add(card.id);
        idsSeenThisPass.add(card.id);
        confirmed.push(card);
        continue;
      }

      // Either unstamped, or a copy of an id already seen. Both need a fresh id
      // written to disk before they may enter the DB.
      if (deferred) {
        // Mint nothing in a file that is likely open in an editor. A duplicate
        // here is skipped entirely rather than upserted: its id IS on disk, but
        // it belongs to the first occurrence, so upserting would overwrite that
        // card's row with the copy's path and text.
        continue;
      }
      if (duplicate) summary.duplicatesReminted++;
      const fresh = this.config.newId();
      seenInThisFile.add(fresh);
      idsSeenThisPass.add(fresh);
      toStamp.push({ card, id: fresh });
    }

    if (toStamp.length === 0) return { confirmed, stat };

    // Reconstruct from lines, rejoining by concatenation so a CRLF file — or one
    // with no trailing newline — comes back byte-identical apart from the
    // stamped lines. Splitting on "\n" would silently convert a whole note.
    const out = lines.slice();
    for (const { card, id } of toStamp) {
      const raw = out[card.lineIndex]!;
      const terminator = /\r?\n$/.exec(raw)?.[0] ?? "";
      const bodyText = terminator ? raw.slice(0, -terminator.length) : raw;
      out[card.lineIndex] = stampLine(bodyText, id) + terminator;
    }

    if (dryRun) {
      // Writes nothing — not a stamp, not a row — but reports what would happen.
      for (const { card, id } of toStamp) confirmed.push({ ...card, id });
      return { confirmed, stat };
    }

    const after = await files.writeIfUnchanged(this.config.notesPath, relPath, out.join(""), stat);
    if (!after) return null;

    for (const { card, id } of toStamp) confirmed.push({ ...card, id });
    return { confirmed, stat: after };
  }

  /** Step 5. */
  private reconcileFile(
    relPath: string,
    cards: ParsedCard[],
    stat: files.StatInfo,
    summary: SyncSummary,
  ): void {
    this.store.transaction(() => {
      const keep: string[] = [];

      for (const card of cards) {
        const id = card.id!;
        const existing = this.store.getCard(id);

        // Copies were already re-minted in step 4, where the fresh id could be
        // written to disk. A surviving path change is therefore a MOVE — except
        // in a deferred file, where nothing could be written, so a copy is
        // skipped entirely rather than allowed to steal the original's row.
        if (existing && existing.file_path !== relPath) {
          if (idIsInFile(this.config.notesPath, existing.file_path, id)) continue;
        }

        keep.push(id);
        if (!existing) {
          summary.cardsNew++;
        } else if (existing.question !== card.question || existing.answer !== card.answer) {
          // A typo fix must not reset scheduling — card_state is untouched.
          summary.cardsUpdated++;
        }
        this.store.upsertCard({
          id,
          file_path: relPath,
          line_no: card.lineIndex + 1,
          question: card.question,
          answer: card.answer,
        });
      }

      summary.cardsPruned += this.store.deleteVanishedInFile(relPath, keep);
      this.store.upsertFile(relPath, stat.mtimeMs, stat.size);
    });
  }

  /**
   * Step 7. Ingest logs incrementally. Never writes to the notes directory,
   * which is the property that lets `review` and `stats` run it implicitly.
   */
  async ingestLogs(now: Date): Promise<{
    shardsSkipped: number;
    bytesRead: number;
    reviewsIngested: number;
    linesSkipped: number;
  }> {
    let shardsSkipped = 0;
    let bytesRead = 0;
    let reviewsIngested = 0;
    let linesSkipped = 0;

    const shards = await files.listShards(this.config.notesPath);
    /** card id -> earliest rated_at that actually inserted this pass. */
    const inserted = new Map<string, string>();

    for (const shard of shards) {
      const cursor = this.store.getLogCursor(shard.name);
      let offset = cursor?.offset ?? 0;

      if (cursor && offset === shard.size) {
        // A frozen monthly shard: do not open the file.
        shardsSkipped++;
        continue;
      }
      // The file shrank, so it was truncated or replaced. Re-read it whole;
      // INSERT OR IGNORE makes that harmless.
      if (shard.size < offset) offset = 0;

      const { text, consumed } = await files.readShardFrom(
        this.config.notesPath,
        shard.name,
        offset,
      );
      bytesRead += consumed - offset;

      const rows: Array<{ card: string; at: string; rating: number }> = [];
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        try {
          const obj = JSON.parse(line) as { card?: unknown; at?: unknown; rating?: unknown };
          if (
            typeof obj.card !== "string" ||
            typeof obj.at !== "string" ||
            typeof obj.rating !== "number"
          ) {
            linesSkipped++;
            continue;
          }
          rows.push({ card: obj.card, at: obj.at, rating: obj.rating });
        } catch {
          // The expected malformed line is a truncated final line from a crash
          // mid-append — the very crash the log-first ordering exists to
          // survive, so aborting here would defeat the rule that motivated it.
          linesSkipped++;
        }
      }

      this.store.transaction(() => {
        for (const r of rows) {
          if (this.store.insertReview(r.card, r.at, r.rating)) {
            reviewsIngested++;
            const prev = inserted.get(r.card);
            if (prev === undefined || r.at < prev) inserted.set(r.card, r.at);
          }
        }
        this.store.setLogCursor(shard.name, shard.size, consumed);
      });
    }

    if (inserted.size > 0) this.replay(inserted, now);
    return { shardsSkipped, bytesRead, reviewsIngested, linesSkipped };
  }

  /**
   * Replay exactly the cards whose rows actually inserted.
   *
   * WHICH cards is decided by insertion, never by comparing timestamps: a
   * machine offline for three days produces reviews all *older* than what has
   * been folded in, and a "newer than last_review" test would skip them
   * forever. HOW is a free choice, because the scheduler is a pure fold.
   */
  private replay(inserted: Map<string, string>, now: Date): void {
    this.store.transaction(() => {
      for (const [id, earliestInserted] of inserted) {
        // Reviews outlive cards: skip card_state for ids with no card row, but
        // never filter the log by what `cards` currently holds.
        if (!this.store.getCard(id)) continue;

        const existing = this.store.getState(id);
        let state: CardState;
        if (existing?.last_review && earliestInserted > existing.last_review) {
          // Every new review is strictly newer than the folded-in state, so the
          // fold can start from that state instead of from zero. Exact, not an
          // approximation — the scheduler is a pure fold.
          state = fold(this.scheduler, existing, this.store.historyAfter(id, existing.last_review), now);
        } else {
          // Something arrived out of order. Replay the full history from zero,
          // in rated_at order, which is a primary-key range scan.
          state = fold(this.scheduler, null, this.store.historyOf(id), now);
        }
        this.store.putState(id, state);
      }
    });
  }

  // -- section 9 -----------------------------------------------------------

  getDueCards(now: Date, limit = 50): DueCard[] {
    const iso = now.toISOString();
    const due = this.store.dueCards(iso, limit);
    const out = due.map(toDueCard);
    if (out.length < limit) {
      for (const row of this.store.newCards(limit - out.length)) out.push(toDueCard(row));
    }
    return out;
  }

  countDue(now: Date): number {
    return this.store.countDue(now.toISOString());
  }

  /**
   * Append to the log, fsync, THEN update SQLite. A crash between the two
   * leaves the DB behind by one review, which the next ingest repairs; the
   * reverse order loses the review outright.
   */
  async reviewCard(cardId: string, rating: 1 | 2 | 3 | 4, now: Date): Promise<void> {
    const previous = this.store.getState(cardId) ?? null;
    const at = files.formatAt(now);

    const line: files.LogLine = { card: cardId, at, rating };
    // Omitted on a first review: there is no previous review to measure from,
    // and writing 0 would be a fabrication the future optimizer reads as fact.
    if (previous?.last_review) {
      const lastMs = new Date(previous.last_review).getTime();
      line.elapsed = round1((now.getTime() - lastMs) / 86_400_000);
      line.scheduled = round1((new Date(previous.due).getTime() - lastMs) / 86_400_000);
    }

    await files.appendLog(this.config.notesPath, this.config.device, line);

    const next = fold(this.scheduler, previous, [{ rated_at: at, rating }], now);
    this.store.transaction(() => {
      this.store.insertReview(cardId, at, rating);
      this.store.putState(cardId, next);
    });
  }

  stats(now: Date): {
    total: number;
    dueNow: number;
    dueBeforeMidnight: number;
    newCards: number;
  } {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return {
      total: this.store.countCards(),
      dueNow: this.store.countDue(now.toISOString()),
      dueBeforeMidnight: this.store.countDueBefore(midnight.toISOString()),
      newCards: this.store.countNew(),
    };
  }

  /**
   * Drop every table, then run a plain sync against the empty database. Not a
   * separate code path — that is the only reason it can be trusted to keep
   * working.
   */
  async rebuild(now: Date, opts: SyncOptions = {}): Promise<SyncSummary> {
    this.store.dropAll();
    return this.sync(now, opts);
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function toDueCard(row: DueRow): DueCard {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    locator: `${row.file_path}:${row.line_no ?? 0}`,
  };
}

function idIsInFile(root: string, relPath: string, id: string): boolean {
  try {
    return readFileSync(path.join(root, relPath), "utf8").includes(`<!-- ${id} -->`);
  } catch {
    return false;
  }
}

async function assertNotesDir(notesPath: string): Promise<void> {
  let st;
  try {
    st = await statAsync(notesPath);
  } catch {
    throw new ConfigError(`notes directory does not exist: ${notesPath}`);
  }
  if (!st.isDirectory()) throw new ConfigError(`notes path is not a directory: ${notesPath}`);
}
