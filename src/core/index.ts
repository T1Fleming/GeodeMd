/**
 * Spec section 8 (sync) and section 9 (review flow). Orchestration; the public
 * API. Section 6's hard rules apply here:
 *   1. never imports `cli`
 *   2. returns data — never console.log, never process.exit, never prompts
 *   3. no ambient state: `now` and `newId` arrive in the config object
 *   5. long operations take onProgress rather than printing
 */

import { readFile as readFileAsync, stat as statAsync } from "node:fs/promises";
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

/**
 * Which part of a sync is running. Reported so a caller drawing a progress bar
 * can say what is happening rather than sitting pinned at 100%: the file loop
 * is only steps 1-5, and on a first ingest of a large log step 7 is the
 * longest part of the whole run.
 */
export type SyncPhase = "scan" | "prune" | "ingest";

export interface SyncOptions {
  full?: boolean;
  dryRun?: boolean;
  /**
   * Called once per enumerated file during "scan" — INCLUDING files the mtime
   * cache skips, so at the top of the scale range this is a million calls. A
   * consumer must treat it as a hot path: record and let a timer render, never
   * render here.
   *
   * `phase` changes then stays put: one call as each later phase begins, with
   * `done === total`, because neither prune nor ingest knows its size up front.
   */
  onProgress?: (done: number, total: number, phase: SyncPhase) => void;
}

export interface SyncSummary {
  filesEnumerated: number;
  filesUnchanged: number;
  filesRead: number;
  filesDeferred: number;
  /**
   * Files that look like a file syncer's conflict copy, and were left alone.
   *
   * Reported rather than silently skipped, because the situation needs a name:
   * a user who sees this line knows exactly what happened, and a user whose
   * folder was quietly half-read does not. Counting what was skipped is what
   * `filesSkippedOnError` and `symlinkedDirsSkipped` already do.
   */
  filesSyncConflict: number;
  /**
   * Files this run wrote a stamp into — or WOULD have, under `dryRun`.
   *
   * The count that answers "how many of my notes does this edit", which
   * `cardsNew` does not: one file can hold fifty new cards. It is the number a
   * first run actually needs, because the first sync of an existing collection
   * rewrites every file containing a card.
   */
  filesStamped: number;
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

/** What `stats` answers. */
export interface Counts {
  total: number;
  dueNow: number;
  dueBeforeMidnight: number;
  newCards: number;
  /**
   * True when *any* capped count stopped at `COUNT_CAP`.
   *
   * For a single figure this is redundant — a capped count is exactly equal to
   * the limit, which is what `host`'s `countText` checks against `COUNT_CAP`. It exists for the SUMS
   * both interfaces show: due-plus-new is a floor if either half is, and it can
   * sit far above the cap while neither did.
   */
  capped: boolean;
}

export interface DueCard {
  id: string;
  question: string;
  answer: string;
  /** Relative to notesPath, exactly as stored. */
  filePath: string;
  lineNo: number | null;
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
    filesSyncConflict: 0,
    filesStamped: 0,
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
      opts.onProgress?.(done, candidates.length, "scan");

      // Step 2: classify. One indexed read, no write.
      const row = this.store.getFile(cand.relPath);
      if (row) {
        hits++;
        if (row.rowid <= maxRowidBefore) seen[row.rowid >> 3]! |= 1 << (row.rowid & 7);
      }

      // Step 2a: a syncer's conflict copy. Counted BEFORE the unchanged check,
      // so the line appears on every sync rather than only the first — the
      // situation persists until the user deals with the file, and a warning
      // that shows once is a warning that gets missed.
      //
      // After the `seen` bookkeeping, not before: marking it keeps step 6 from
      // treating the cards of an already-synced conflict copy as vanished.
      // This change stops NEW duplicates; it deliberately does not delete
      // anything a previous sync already created.
      if (files.isSyncConflict(cand.relPath)) {
        summary.filesSyncConflict++;
        continue;
      }

      if (row && !opts.full && row.mtime_ms === cand.mtimeMs && row.size === cand.size) {
        summary.filesUnchanged++;
        continue;
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
        await this.reconcileFile(
          cand.relPath,
          outcome.confirmed,
          outcome.stat,
          summary,
          outcome.pending,
        );
      } else {
        for (const c of outcome.confirmed) {
          if (!this.store.getCard(c.id!)) summary.cardsNew++;
        }
      }
    }

    // Step 6: prune — and usually decide not to.
    opts.onProgress?.(candidates.length, candidates.length, "prune");
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

    // Step 7: ingest logs. Reported as its own phase: on a first ingest of a
    // large log this is the longest part of the run, and a bar that stopped at
    // the end of the file loop would sit at 100% through all of it.
    opts.onProgress?.(candidates.length, candidates.length, "ingest");
    if (!dryRun) {
      const ingest = await this.ingestLogs(now);
      summary.logShardsSkipped = ingest.shardsSkipped;
      summary.logBytesRead = ingest.bytesRead;
      summary.reviewsIngested = ingest.reviewsIngested;
      summary.logLinesSkipped = ingest.linesSkipped;
    }

    /**
     * Fold the write-ahead log back in before handing the process back.
     *
     * A sync of a large collection leaves a large WAL, and SQLite folds it in on
     * whichever write comes next — which, in a review session, is the user's
     * first rating. ADR 0024 measured that as a 115–299 ms stall landing on a
     * keypress. Paying it here puts the cost inside the operation that earned
     * it, where a progress bar is already on screen, and it is best-effort:
     * `checkpoint` never blocks on a reader.
     */
    if (!dryRun) this.store.checkpoint();

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
  }): Promise<{ confirmed: ParsedCard[]; stat: files.StatInfo; pending: boolean } | null> {
    const { relPath, text, parsed, stat, deferred, dryRun, idsSeenThisPass, summary } = args;

    const lines = splitLines(text);
    const confirmed: ParsedCard[] = [];
    const toStamp: Array<{ card: ParsedCard; id: string }> = [];
    const seenInThisFile = new Set<string>();
    /** Work this pass could not finish, so the file must be re-read next time. */
    let pending = false;

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
            duplicate = await idIsInFile(this.config.notesPath, existing.file_path, card.id);
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
        //
        // Record that work remains. Without this the `files` row is written
        // with the current (mtime, size), the next sync's fast path calls the
        // file unchanged, and the card is never stamped at all — "waits for the
        // next sync" silently becomes "waits forever".
        pending = true;
        continue;
      }
      if (duplicate) summary.duplicatesReminted++;
      const fresh = this.config.newId();
      seenInThisFile.add(fresh);
      idsSeenThisPass.add(fresh);
      toStamp.push({ card, id: fresh });
    }

    if (toStamp.length === 0) return { confirmed, stat, pending };

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
      // Writes nothing — not a stamp, not a row — but reports what would happen,
      // and "how many files would you edit" is the question a first run asks.
      summary.filesStamped++;
      for (const { card, id } of toStamp) confirmed.push({ ...card, id });
      return { confirmed, stat, pending };
    }

    const after = await files.writeIfUnchanged(this.config.notesPath, relPath, out.join(""), stat);
    // Counted only after the write actually landed. The re-stat guard can fire,
    // and a file this run did not touch must not be reported as stamped.
    if (!after) return null;
    summary.filesStamped++;

    for (const { card, id } of toStamp) confirmed.push({ ...card, id });
    return { confirmed, stat: after, pending };
  }

  /** Step 5. */
  private async reconcileFile(
    relPath: string,
    cards: ParsedCard[],
    stat: files.StatInfo,
    summary: SyncSummary,
    pending = false,
  ): Promise<void> {
    // Copies were already re-minted in step 4, where the fresh id could be
    // written to disk. A surviving path change is therefore a MOVE — except in
    // a deferred file, where nothing could be written, so a copy is skipped
    // entirely rather than allowed to steal the original's row.
    //
    // Deciding that needs to read the old file, and a better-sqlite3
    // transaction cannot await. So the reads happen HERE, before the
    // transaction opens, and the transaction runs over their plain-data
    // result. That is the better shape regardless: the transaction is now pure
    // and holds the write lock only for as long as it writes.
    const copiesElsewhere = new Set<string>();
    for (const card of cards) {
      const id = card.id!;
      const existing = this.store.getCard(id);
      if (existing && existing.file_path !== relPath) {
        if (await idIsInFile(this.config.notesPath, existing.file_path, id)) {
          copiesElsewhere.add(id);
        }
      }
    }

    this.store.transaction(() => {
      const keep: string[] = [];

      for (const card of cards) {
        const id = card.id!;
        if (copiesElsewhere.has(id)) continue;

        // Re-read inside the transaction rather than reusing the row from the
        // pre-pass: the decision above only needed a path, while this needs the
        // text to classify new-versus-updated, and it should see the same
        // snapshot as the write that follows it.
        const existing = this.store.getCard(id);

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

      // Only record the file as seen when this pass finished with it. Leaving
      // the row stale (or absent) is what makes the next sync re-read a
      // deferred file instead of calling it unchanged.
      if (!pending) this.store.upsertFile(relPath, stat.mtimeMs, stat.size);
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

  /**
   * How many cards are due, counting no further than `limit`.
   *
   * The limit is the caller's because it is a presentation decision — `host`'s
   * `COUNT_CAP` — and because the cost of counting is proportional to the size
   * of the due set, not the collection (ADR 0024). `core` reads no policy of
   * its own, here as everywhere.
   */
  countDue(now: Date, limit: number): number {
    return this.store.countDue(now.toISOString(), limit);
  }

  /**
   * Append to the log, fsync, THEN update SQLite. A crash between the two
   * leaves the DB behind by one review, which the next ingest repairs; the
   * reverse order loses the review outright.
   *
   * **Returns the resulting state**, which is the only way a caller can learn
   * that the scheduler wants this card again in ten minutes. Recomputing it
   * outside would mean a second copy of the fold, and the two would disagree
   * the first time either changed (ADR 0023).
   */
  async reviewCard(cardId: string, rating: 1 | 2 | 3 | 4, now: Date): Promise<CardState> {
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
    return next;
  }

  /**
   * The four counts, with every unbounded one stopping at `limit`.
   *
   * `limit` is an argument for the same reason `now` is: it is policy, and
   * `core` takes its policy from the caller. Both interfaces pass `host`'s
   * `COUNT_CAP` (ADR 0024).
   *
   * `total` is the one count not capped: it is a fact about the collection
   * rather than about a backlog, and every other figure here counts a set the
   * user's own habits can make arbitrarily large.
   */
  stats(now: Date, limit: number): Counts {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const dueNow = this.store.countDue(now.toISOString(), limit);
    const dueBeforeMidnight = this.store.countDueBefore(midnight.toISOString(), limit);
    const newCards = this.store.countNew(limit);
    return {
      total: this.store.countCards(),
      dueNow,
      dueBeforeMidnight,
      newCards,
      capped: dueNow >= limit || dueBeforeMidnight >= limit || newCards >= limit,
    };
  }

  /**
   * A card's annotation, or null when it has none ([ADR 0029](../../docs/decisions/0029-annotations.md)).
   *
   * Straight to `files/`, with no database involved: the file under
   * `.sr/annotations/` is the whole store, which is why sync, `rebuild` and
   * the schema know nothing about annotations. No `now` either — nothing
   * about an annotation is timestamped.
   */
  async getAnnotation(cardId: string): Promise<string | null> {
    return files.readAnnotation(this.config.notesPath, cardId);
  }

  /** Write a card's annotation; blank text removes it. See `getAnnotation`. */
  async setAnnotation(cardId: string, text: string): Promise<void> {
    await files.writeAnnotation(this.config.notesPath, cardId, text);
  }

  /**
   * A note's text as it is on disk now, and the 1-based line the card is on
   * in it — null when it is not there any more (#51).
   *
   * Found by its **stamp**, not by the line the last sync stored: the note
   * may have been edited since, and the stored line would then hold something
   * else. Read-only, and nothing is written to the database: the viewer shows
   * what is on disk, and bringing the cache up to date is sync's job.
   *
   * `relPath` is relative to the notes folder, as stored. Confining it there
   * is the caller's job (`electron/main/note.ts`); a path is not something
   * `core` second-guesses anywhere else either.
   */
  async readNote(relPath: string, cardId: string): Promise<{ text: string; line: number | null }> {
    const text = await files.readFile(this.config.notesPath, relPath);
    const card = parse(text).find((c) => c.id === cardId);
    return { text, line: card ? card.lineIndex + 1 : null };
  }

  /**
   * Fold the write-ahead log back into the database.
   *
   * `sync` already does this before it returns (ADR 0024); this is for a caller
   * that wants the same guarantee without running one — the scale harness
   * measures each operation from a database that owes nothing, because
   * otherwise the first write pays for the previous run's pages.
   */
  checkpoint(): void {
    this.store.checkpoint();
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
    filePath: row.file_path,
    lineNo: row.line_no,
    locator: `${row.file_path}:${row.line_no ?? 0}`,
  };
}

/**
 * Is `id` still stamped in the file its row names? The move-versus-copy test of
 * section 4: gone from the old path means a MOVE, still there means the new
 * occurrence is a COPY.
 *
 * Async, and that is not incidental. `files/` rejects `statSync` for the same
 * reason (ADR 0013) — `core` is shared with an Electron peer, where a blocking
 * whole-file read of a user's note is a frozen UI rather than an invisible
 * pause in a process about to exit. Sitting off the no-change fast path is not
 * a licence to block.
 */
async function idIsInFile(root: string, relPath: string, id: string): Promise<boolean> {
  try {
    const text = await readFileAsync(path.join(root, relPath), "utf8");
    return text.includes(`<!-- ${id} -->`);
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
