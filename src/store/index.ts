/**
 * Spec section 5. The ONLY module that touches SQLite.
 *
 * The entire database is *derivable* — `cards`/`files` from the notes
 * directory, `reviews`/`log_files` from the logs, `card_state` from replaying
 * `reviews`. No column here exists only here.
 */

import { mkdirSync } from "node:fs";
import * as nodePath from "node:path";
import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";

export interface CardRow {
  id: string;
  file_path: string;
  line_no: number | null;
  question: string;
  answer: string;
  type: string;
  reviewed: number;
}

export interface FileRow {
  rowid: number;
  path: string;
  mtime_ms: number;
  size: number;
}

export interface CardState {
  due: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

export interface ReviewRow {
  card_id: string;
  rated_at: string;
  rating: number;
}

export interface DueRow {
  id: string;
  question: string;
  answer: string;
  file_path: string;
  line_no: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cards (
  id         TEXT PRIMARY KEY,
  file_path  TEXT NOT NULL,
  line_no    INTEGER,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'basic',
  reviewed   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cards_path ON cards(file_path, line_no);
CREATE INDEX IF NOT EXISTS idx_cards_new  ON cards(file_path, line_no) WHERE reviewed = 0;

-- A rowid table ON PURPOSE. TEXT PRIMARY KEY leaves the implicit rowid in
-- place, and section 8 step 6 marks a bitmap by rowid to find vanished files
-- without a second walk. Do not "optimize" this to WITHOUT ROWID.
CREATE TABLE IF NOT EXISTS files (
  path      TEXT PRIMARY KEY,
  mtime_ms  INTEGER NOT NULL,
  size      INTEGER NOT NULL
);

-- No foreign key on card_id: reviews outlive the cards they refer to.
CREATE TABLE IF NOT EXISTS reviews (
  card_id  TEXT NOT NULL,
  rated_at TEXT NOT NULL,
  rating   INTEGER NOT NULL,
  PRIMARY KEY (card_id, rated_at)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS log_files (
  name    TEXT PRIMARY KEY,
  size    INTEGER NOT NULL,
  offset  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS card_state (
  card_id     TEXT PRIMARY KEY,
  due         TEXT NOT NULL,
  stability   REAL,
  difficulty  REAL,
  reps        INTEGER NOT NULL DEFAULT 0,
  lapses      INTEGER NOT NULL DEFAULT 0,
  state       INTEGER NOT NULL,
  last_review TEXT
);
CREATE INDEX IF NOT EXISTS idx_state_due ON card_state(due);
`;

const TABLES = ["cards", "files", "reviews", "log_files", "card_state"] as const;

export class Store {
  readonly db: Db;

  constructor(dbPath: string) {
    // The DB lives outside the notes directory (section 5), at an XDG path that
    // will not exist on a first run. Create it rather than failing.
    if (dbPath !== ":memory:") mkdirSync(nodePath.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    // Section 5. `synchronous = NORMAL` is safe under WAL and keeps a bulk sync
    // from fsyncing per statement — the durability that matters lives in the
    // log, which fsyncs explicitly, so the database can afford to be the fast
    // half. The busy timeout stays at a few seconds on purpose (section 9).
    if (dbPath !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("cache_size = -32000");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Prepared-statement cache. Section 5: "Every write path runs inside a
   * transaction with prepared statements. At a million cards this is not a
   * micro-optimization." Re-preparing per call would reintroduce exactly the
   * per-row cost the scale target rules out.
   */
  private readonly stmts = new Map<string, ReturnType<Db["prepare"]>>();

  private stmt(sql: string): ReturnType<Db["prepare"]> {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  private one<T>(sql: string, ...params: unknown[]): T | undefined {
    return (this.stmt(sql).get as (...a: unknown[]) => unknown)(...params) as T | undefined;
  }

  private many<T>(sql: string, ...params: unknown[]): T[] {
    return (this.stmt(sql).all as (...a: unknown[]) => unknown[])(...params) as T[];
  }

  private run(sql: string, ...params: unknown[]): { changes: number } {
    return (this.stmt(sql).run as (...a: unknown[]) => { changes: number })(...params);
  }

  /** Run `fn` in a transaction. Section 5: every write path is transactional. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** `rebuild` drops every table, then runs a plain sync against the empty db. */
  dropAll(): void {
    for (const t of TABLES) this.db.exec(`DROP TABLE IF EXISTS ${t}`);
    this.db.exec(SCHEMA);
  }

  /** Total writes SQLite has performed. The scale harness asserts this is flat. */
  totalChanges(): number {
    return this.one<{ n: number }>("SELECT total_changes() AS n")!.n;
  }

  // -- files ---------------------------------------------------------------

  countFiles(): number {
    return this.one<{ n: number }>("SELECT COUNT(*) AS n FROM files")!.n;
  }

  maxFileRowid(): number {
    return this.one<{ n: number | null }>("SELECT MAX(rowid) AS n FROM files")!.n ?? 0;
  }

  getFile(path: string): FileRow | undefined {
    return this.one<FileRow>("SELECT rowid, path, mtime_ms, size FROM files WHERE path = ?", path);
  }

  upsertFile(path: string, mtimeMs: number, size: number): void {
    this.run(
      `INSERT INTO files (path, mtime_ms, size) VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size`,
      path,
      mtimeMs,
      size,
    );
  }

  /** Every file row, by rowid. Step 6 scans this only when something vanished. */
  allFileRowids(): Array<{ rowid: number; path: string }> {
    return this.many<{ rowid: number; path: string }>(
      "SELECT rowid, path FROM files ORDER BY rowid",
    );
  }

  deleteFiles(paths: string[]): void {
    for (const p of paths) {
      this.run("DELETE FROM cards WHERE file_path = ?", p);
      this.run("DELETE FROM files WHERE path = ?", p);
    }
  }

  // -- cards ---------------------------------------------------------------

  getCard(id: string): CardRow | undefined {
    return this.one<CardRow>("SELECT * FROM cards WHERE id = ?", id);
  }

  cardIdsInFile(filePath: string): string[] {
    return this.many<{ id: string }>("SELECT id FROM cards WHERE file_path = ?", filePath).map(
      (r) => r.id,
    );
  }

  /**
   * Section 5: `reviewed` is set on insert from whether `card_state` already
   * holds the id. A restored card has state and must not re-enter the queue as
   * new — that is the second half of the prune test in section 10.
   */
  upsertCard(row: Omit<CardRow, "reviewed" | "type">): void {
    this.stmt(
      `INSERT INTO cards (id, file_path, line_no, question, answer, type, reviewed)
       VALUES (@id, @file_path, @line_no, @question, @answer, 'basic',
               EXISTS(SELECT 1 FROM card_state WHERE card_id = @id))
       ON CONFLICT(id) DO UPDATE SET
         file_path = excluded.file_path,
         line_no   = excluded.line_no,
         question  = excluded.question,
         answer    = excluded.answer`,
    ).run(row as never);
  }

  /**
   * Delete the cards this file used to hold and no longer does.
   *
   * Scoping by path is what makes it safe against walk order: a card that moved
   * to another file already had its row's path updated, so it is not matched.
   */
  deleteVanishedInFile(filePath: string, keepIds: string[]): number {
    if (keepIds.length === 0) {
      return this.run("DELETE FROM cards WHERE file_path = ?", filePath).changes;
    }
    const placeholders = keepIds.map(() => "?").join(",");
    return this.run(
      `DELETE FROM cards WHERE file_path = ? AND id NOT IN (${placeholders})`,
      filePath,
      ...keepIds,
    ).changes;
  }

  countCards(): number {
    return this.one<{ n: number }>("SELECT COUNT(*) AS n FROM cards")!.n;
  }

  /**
   * How many cards have never been reviewed, counting no further than `limit`.
   *
   * Capped for the same reason `countDue` is (ADR 0024), and the numbers are
   * nearly as bad: this is a count of every entry in the partial index, which
   * at a million cards with 600,000 of them new measured 526 ms on a cold cache
   * against 10 ms for the first ten thousand. What it counts is a set the user's
   * habits set the size of — a collection synced and not yet reviewed is all of
   * it — so the bound belongs here rather than in a hope.
   *
   * `countCards` is deliberately NOT capped: the total is a fact about the
   * collection rather than about a backlog, and "10000+ cards in total" would
   * be a worse answer than the 4 ms it costs warm.
   */
  countNew(limit: number): number {
    return this.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM (SELECT 1 FROM cards WHERE reviewed = 0 LIMIT ?)",
      limit,
    )!.n;
  }

  // -- reviews -------------------------------------------------------------

  /** INSERT OR IGNORE; returns true when the row actually inserted. */
  insertReview(cardId: string, ratedAt: string, rating: number): boolean {
    return (
      this.run(
        "INSERT OR IGNORE INTO reviews (card_id, rated_at, rating) VALUES (?, ?, ?)",
        cardId,
        ratedAt,
        rating,
      ).changes > 0
    );
  }

  /** A card's full history, in chronological order — a PK range scan. */
  historyOf(cardId: string): ReviewRow[] {
    return this.many<ReviewRow>(
      "SELECT card_id, rated_at, rating FROM reviews WHERE card_id = ? ORDER BY rated_at",
      cardId,
    );
  }

  /** Reviews for one card strictly after `after`, chronologically. */
  historyAfter(cardId: string, after: string): ReviewRow[] {
    return this.many<ReviewRow>(
      `SELECT card_id, rated_at, rating FROM reviews
        WHERE card_id = ? AND rated_at > ? ORDER BY rated_at`,
      cardId,
      after,
    );
  }

  countReviews(): number {
    return this.one<{ n: number }>("SELECT COUNT(*) AS n FROM reviews")!.n;
  }

  // -- log cursor ----------------------------------------------------------

  getLogCursor(name: string): { size: number; offset: number } | undefined {
    return this.one<{ size: number; offset: number }>(
      "SELECT size, offset FROM log_files WHERE name = ?",
      name,
    );
  }

  setLogCursor(name: string, size: number, offset: number): void {
    this.run(
      `INSERT INTO log_files (name, size, offset) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET size = excluded.size, offset = excluded.offset`,
      name,
      size,
      offset,
    );
  }

  // -- card_state ----------------------------------------------------------

  getState(cardId: string): CardState | undefined {
    return this.one<CardState>(
      `SELECT due, stability, difficulty, reps, lapses, state, last_review
         FROM card_state WHERE card_id = ?`,
      cardId,
    );
  }

  /**
   * Upsert state and set `cards.reviewed` together, so the denormalization in
   * section 5 cannot drift within a transaction.
   */
  putState(cardId: string, s: CardState): void {
    this.stmt(
      `INSERT INTO card_state (card_id, due, stability, difficulty, reps, lapses, state, last_review)
       VALUES (@card_id, @due, @stability, @difficulty, @reps, @lapses, @state, @last_review)
       ON CONFLICT(card_id) DO UPDATE SET
         due = excluded.due, stability = excluded.stability,
         difficulty = excluded.difficulty, reps = excluded.reps,
         lapses = excluded.lapses, state = excluded.state,
         last_review = excluded.last_review`,
    ).run({ card_id: cardId, ...s } as never);
    this.run("UPDATE cards SET reviewed = 1 WHERE id = ?", cardId);
  }

  // -- queue (section 9) ---------------------------------------------------

  dueCards(now: string, limit: number): DueRow[] {
    return this.many<DueRow>(
      `SELECT c.id, c.question, c.answer, c.file_path, c.line_no
         FROM card_state s JOIN cards c ON c.id = s.card_id
        WHERE s.due <= ?
        ORDER BY s.due
        LIMIT ?`,
      now,
      limit,
    );
  }

  newCards(limit: number): DueRow[] {
    return this.many<DueRow>(
      `SELECT id, question, answer, file_path, line_no
         FROM cards
        WHERE reviewed = 0
        ORDER BY file_path, line_no
        LIMIT ?`,
      limit,
    );
  }

  /**
   * Joined to `cards` on purpose, so this counts the same population
   * `dueCards` draws from. `card_state` deliberately outlives the card it
   * belongs to — see `upsertCard`, where a restored card's state is what keeps
   * it out of the new queue — so counting state alone reports cards that no
   * longer exist, and `geode stats` could print due + new greater than total.
   */
  /**
   * How many cards are due, counting no further than `limit`.
   *
   * The limit is not a nicety. This counts *matching rows*, each of which
   * probes `cards` to check the card still exists — `card_state` deliberately
   * outlives the card it belongs to, so counting state alone over-reports — and
   * the cost is therefore proportional to the size of the due set rather than
   * to the collection. Measured at a million cards with 389,000 of them due, it
   * is 205 ms: a fifth of a second of frozen main process for a number on a
   * screen (ADR 0024). Stopping the scan early bounds that by construction,
   * where a faster query would only move the wall further out.
   *
   * The caller decides what "far enough" means and what to say about a count
   * that hit it: both are `host`'s (`COUNT_CAP`, `countText`), and `core` takes
   * the limit as an argument rather than knowing it.
   */
  countDue(now: string, limit: number): number {
    return this.one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (
         SELECT 1
           FROM card_state s JOIN cards c ON c.id = s.card_id
          WHERE s.due <= ?
          LIMIT ?
       )`,
      now,
      limit,
    )!.n;
  }

  /** Section 9: "due before local midnight" is a forecast, not the queue. */
  countDueBefore(instant: string, limit: number): number {
    return this.countDue(instant, limit);
  }

  /**
   * Fold the write-ahead log back into the database, as far as it can without
   * blocking a reader.
   *
   * SQLite does this by itself every 1,000 pages, and the auto-checkpoint that
   * follows a large sync is one of the two interactive stalls ADR 0024
   * measured: the WAL a million-card sync leaves behind is folded in by
   * whichever write comes next, which is the user's first rating. Doing it here
   * puts the cost inside the operation that earned it — one with a progress bar
   * already on screen.
   *
   * `PASSIVE` rather than `TRUNCATE` because it never waits: a checkpoint that
   * blocks on a reader would trade a stall for a hang, which is a worse deal.
   */
  checkpoint(): { busy: number; log: number; checkpointed: number } {
    // Returned rather than discarded so the work is observable: `PASSIVE`
    // reuses the WAL file instead of shrinking it, so the file's size says
    // nothing about whether anything was folded in. `log` and `checkpointed`
    // are the WAL's size in frames and how many of them are back-filled —
    // equal means the whole log is in the database.
    const [row] = this.db.pragma("wal_checkpoint(PASSIVE)") as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;
    return row ?? { busy: 0, log: 0, checkpointed: 0 };
  }
}
