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
  /**
   * The headings and parent bullets above the card, as JSON (ADR 0031).
   * Derived from the note alone, like question and answer, so a rebuild
   * reproduces it. `core` owns the shape; to the store it is text.
   */
  context: string;
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
  /**
   * Which short-term step the card is on. FSRS-6 counts them and the next
   * interval depends on it — `1` on step two of `["1m", "10m"]` is not `1` on
   * step one. Replayed from the log like every other column (ADR 0028).
   */
  learning_steps: number;
}

export interface ReviewRow {
  card_id: string;
  rated_at: string;
  rating: number;
}

/** An exercise as sync found it (ADR 0038). Derived from its note alone. */
export interface ExerciseRow {
  path: string;
  title: string;
  statement: string;
}

/** A spot or solve review of a skill, as the log holds it (ADR 0038). */
export interface SkillReviewRow {
  rated_at: string;
  rating: number;
  exercise: string;
}

/**
 * One exercise in a skill's pool, with what serving it would need to know:
 * when it was last served for any skill, and whether this skill has served it
 * for this kind of review before. Ranking them is `core`'s.
 */
export interface PoolEntry {
  path: string;
  /** The latest `rated_at` of any skill review that served it; null if never served. */
  last_any: string | null;
  /** 1 when this skill has served it for this kind before. */
  seen: number;
}

export interface DueRow {
  id: string;
  question: string;
  answer: string;
  context: string;
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
  reviewed   INTEGER NOT NULL DEFAULT 0,
  context    TEXT NOT NULL DEFAULT '[]'
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
  last_review TEXT,
  learning_steps INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_state_due ON card_state(due);

-- Exercises (ADR 0038): one row per note that names its skills, and one per
-- pool it is in. Derived from the notes, and pruned with their file.
CREATE TABLE IF NOT EXISTS exercises (
  path       TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  statement  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exercise_skills (
  skill  TEXT NOT NULL,
  path   TEXT NOT NULL,
  PRIMARY KEY (skill, path)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_exercise_skills_path ON exercise_skills(path);

-- A skill's schedule, one per kind of review. Replayed from skill_reviews, the
-- way card_state is from reviews, and kept when the pool empties (ADR 0010).
CREATE TABLE IF NOT EXISTS skill_state (
  skill       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  due         TEXT NOT NULL,
  stability   REAL,
  difficulty  REAL,
  reps        INTEGER NOT NULL DEFAULT 0,
  lapses      INTEGER NOT NULL DEFAULT 0,
  state       INTEGER NOT NULL,
  last_review TEXT,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (skill, kind)
);
CREATE INDEX IF NOT EXISTS idx_skill_state_due ON skill_state(kind, due);

-- No foreign key, like reviews: history outlives the pool it was served from.
CREATE TABLE IF NOT EXISTS skill_reviews (
  skill     TEXT NOT NULL,
  kind      TEXT NOT NULL,
  rated_at  TEXT NOT NULL,
  rating    INTEGER NOT NULL,
  exercise  TEXT NOT NULL,
  repeat    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (skill, kind, rated_at)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_skill_reviews_exercise ON skill_reviews(exercise, rated_at);

-- Facts about the cache rather than the notes: today only which scheduler
-- derived card_state (ADR 0028). Derived from the code, the way the schema is,
-- so a rebuild writes the current one.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const TABLES = [
  "cards",
  "files",
  "reviews",
  "log_files",
  "card_state",
  "meta",
  "exercises",
  "exercise_skills",
  "skill_state",
  "skill_reviews",
] as const;

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
    this.addMissingColumns();
  }

  /**
   * Bring a database from before a column existed up to the schema.
   *
   * `CREATE TABLE IF NOT EXISTS` leaves an existing table alone, so a database
   * written by an older build keeps its old `card_state` — and every query
   * naming `learning_steps` would fail before anything could re-derive it. The
   * default is a placeholder, not a value: a database this adds the column to
   * was scheduled by ts-fsrs 4, so its scheduler version differs and `core`
   * re-derives every row before the app reads one (ADR 0028).
   */
  private addMissingColumns(): void {
    const cols = this.db.pragma("table_info(card_state)") as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "learning_steps")) {
      this.db.exec("ALTER TABLE card_state ADD COLUMN learning_steps INTEGER NOT NULL DEFAULT 0");
    }
    // Empty until the next sync re-reads every note, which a parser version
    // older than the code's makes it do (ADR 0031).
    const cardCols = this.db.pragma("table_info(cards)") as Array<{ name: string }>;
    if (!cardCols.some((c) => c.name === "context")) {
      this.db.exec("ALTER TABLE cards ADD COLUMN context TEXT NOT NULL DEFAULT '[]'");
    }
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
      this.putExercise(p, null);
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
      `INSERT INTO cards (id, file_path, line_no, question, answer, context, type, reviewed)
       VALUES (@id, @file_path, @line_no, @question, @answer, @context, 'basic',
               EXISTS(SELECT 1 FROM card_state WHERE card_id = @id))
       ON CONFLICT(id) DO UPDATE SET
         file_path = excluded.file_path,
         line_no   = excluded.line_no,
         question  = excluded.question,
         answer    = excluded.answer,
         context   = excluded.context`,
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

  // -- exercises (ADR 0038) ------------------------------------------------

  /**
   * Replace what a note holds as an exercise: its row and its pools, or
   * nothing when `exercise` is null. Whole, every time — a note's skills are a
   * list, and diffing it would buy nothing a re-read does not already pay for.
   */
  putExercise(path: string, exercise: { title: string; statement: string; skills: string[] } | null): void {
    this.run("DELETE FROM exercise_skills WHERE path = ?", path);
    this.run("DELETE FROM exercises WHERE path = ?", path);
    if (!exercise) return;
    this.run(
      "INSERT INTO exercises (path, title, statement) VALUES (?, ?, ?)",
      path,
      exercise.title,
      exercise.statement,
    );
    for (const skill of exercise.skills) {
      this.run("INSERT INTO exercise_skills (skill, path) VALUES (?, ?)", skill, path);
    }
  }

  getExercise(path: string): ExerciseRow | undefined {
    return this.one<ExerciseRow>("SELECT path, title, statement FROM exercises WHERE path = ?", path);
  }

  /** The skills an exercise names, in name order. */
  skillsOfExercise(path: string): string[] {
    return this.many<{ skill: string }>(
      "SELECT skill FROM exercise_skills WHERE path = ? ORDER BY skill",
      path,
    ).map((r) => r.skill);
  }

  /** A skill's pool as it is shown: each exercise's path and title, by title. */
  poolTitles(skill: string): Array<{ path: string; title: string }> {
    return this.many<{ path: string; title: string }>(
      `SELECT e.path, e.title FROM exercise_skills es JOIN exercises e ON e.path = es.path
        WHERE es.skill = ? ORDER BY e.title, e.path`,
      skill,
    );
  }

  countExercises(): number {
    return this.one<{ n: number }>("SELECT COUNT(*) AS n FROM exercises")!.n;
  }

  /** Skills with at least one exercise in their pool. */
  countSkills(): number {
    return this.one<{ n: number }>("SELECT COUNT(DISTINCT skill) AS n FROM exercise_skills")!.n;
  }

  /**
   * A skill's pool, with what the serving rule ranks it by (ADR 0038). Every
   * input is the notes and the log, so a rebuild reproduces the choice.
   */
  poolOf(skill: string, kind: string): PoolEntry[] {
    return this.many<PoolEntry>(
      `SELECT es.path,
              (SELECT MAX(r.rated_at) FROM skill_reviews r WHERE r.exercise = es.path) AS last_any,
              EXISTS(SELECT 1 FROM skill_reviews r
                      WHERE r.skill = es.skill AND r.kind = ? AND r.exercise = es.path) AS seen
         FROM exercise_skills es
        WHERE es.skill = ?
        ORDER BY es.path`,
      kind,
      skill,
    );
  }

  /**
   * Skills due for one kind of review: those whose schedule has come due, then
   * those never reviewed for it, by name — the order cards are served in.
   * Only skills whose pool holds an exercise: one with nothing to serve is
   * never due, though its schedule is kept (ADR 0010).
   */
  dueSkills(kind: string, now: string, limit: number): string[] {
    const due = this.many<{ skill: string }>(
      `SELECT s.skill FROM skill_state s
        WHERE s.kind = ? AND s.due <= ?
          AND EXISTS(SELECT 1 FROM exercise_skills es WHERE es.skill = s.skill)
        ORDER BY s.due, s.skill
        LIMIT ?`,
      kind,
      now,
      limit,
    ).map((r) => r.skill);
    if (due.length >= limit) return due;
    const fresh = this.many<{ skill: string }>(
      `SELECT DISTINCT es.skill FROM exercise_skills es
        WHERE NOT EXISTS(SELECT 1 FROM skill_state s WHERE s.skill = es.skill AND s.kind = ?)
        ORDER BY es.skill
        LIMIT ?`,
      kind,
      limit - due.length,
    ).map((r) => r.skill);
    return [...due, ...fresh];
  }

  /** How many skills `dueSkills` would return, counting no further than `limit` (ADR 0024). */
  countDueSkills(kind: string, now: string, limit: number): number {
    return this.dueSkills(kind, now, limit).length;
  }

  /** INSERT OR IGNORE; true when the row actually inserted. */
  insertSkillReview(
    skill: string,
    kind: string,
    ratedAt: string,
    rating: number,
    exercise: string,
    repeat: boolean,
  ): boolean {
    return (
      this.run(
        `INSERT OR IGNORE INTO skill_reviews (skill, kind, rated_at, rating, exercise, repeat)
         VALUES (?, ?, ?, ?, ?, ?)`,
        skill,
        kind,
        ratedAt,
        rating,
        exercise,
        repeat ? 1 : 0,
      ).changes > 0
    );
  }

  /** One skill's history for one kind, chronologically — a PK range scan. */
  skillHistory(skill: string, kind: string, after: string | null = null): SkillReviewRow[] {
    return this.many<SkillReviewRow>(
      `SELECT rated_at, rating, exercise FROM skill_reviews
        WHERE skill = ? AND kind = ? AND rated_at > ? ORDER BY rated_at`,
      skill,
      kind,
      after ?? "",
    );
  }

  countSkillReviews(): number {
    return this.one<{ n: number }>("SELECT COUNT(*) AS n FROM skill_reviews")!.n;
  }

  getSkillState(skill: string, kind: string): CardState | undefined {
    return this.one<CardState>(
      `SELECT due, stability, difficulty, reps, lapses, state, last_review, learning_steps
         FROM skill_state WHERE skill = ? AND kind = ?`,
      skill,
      kind,
    );
  }

  putSkillState(skill: string, kind: string, s: CardState): void {
    this.stmt(
      `INSERT INTO skill_state
         (skill, kind, due, stability, difficulty, reps, lapses, state, last_review, learning_steps)
       VALUES (@skill, @kind, @due, @stability, @difficulty, @reps, @lapses, @state, @last_review,
               @learning_steps)
       ON CONFLICT(skill, kind) DO UPDATE SET
         due = excluded.due, stability = excluded.stability,
         difficulty = excluded.difficulty, reps = excluded.reps,
         lapses = excluded.lapses, state = excluded.state,
         last_review = excluded.last_review, learning_steps = excluded.learning_steps`,
    ).run({ skill, kind, ...s } as never);
  }

  /** Every (skill, kind) with a schedule, including those whose pool is empty. */
  scheduledSkills(): Array<{ skill: string; kind: string }> {
    return this.many<{ skill: string; kind: string }>(
      "SELECT skill, kind FROM skill_state ORDER BY skill, kind",
    );
  }

  deleteSkillState(skill: string, kind: string): void {
    this.run("DELETE FROM skill_state WHERE skill = ? AND kind = ?", skill, kind);
  }

  // -- log cursor ----------------------------------------------------------

  getLogCursor(name: string): { size: number; offset: number } | undefined {
    return this.one<{ size: number; offset: number }>(
      "SELECT size, offset FROM log_files WHERE name = ?",
      name,
    );
  }

  /**
   * Forget how far every shard has been read, so the next ingest reads each
   * one again from the start. `INSERT OR IGNORE` makes that harmless; it is how
   * lines an older build skipped get read (ADR 0038).
   */
  resetLogCursors(): void {
    this.run("DELETE FROM log_files");
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
      `SELECT due, stability, difficulty, reps, lapses, state, last_review, learning_steps
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
      `INSERT INTO card_state
         (card_id, due, stability, difficulty, reps, lapses, state, last_review, learning_steps)
       VALUES (@card_id, @due, @stability, @difficulty, @reps, @lapses, @state, @last_review,
               @learning_steps)
       ON CONFLICT(card_id) DO UPDATE SET
         due = excluded.due, stability = excluded.stability,
         difficulty = excluded.difficulty, reps = excluded.reps,
         lapses = excluded.lapses, state = excluded.state,
         last_review = excluded.last_review, learning_steps = excluded.learning_steps`,
    ).run({ card_id: cardId, ...s } as never);
    this.run("UPDATE cards SET reviewed = 1 WHERE id = ?", cardId);
  }

  /**
   * Every id that has a schedule, in id order — including those whose card
   * row is gone, because `card_state` outlives its card on purpose (see
   * `upsertCard`). Re-deriving the schedule has to reach those too, or a
   * restored card would come back on the old scheduler's numbers.
   */
  scheduledIds(): string[] {
    return this.many<{ card_id: string }>("SELECT card_id FROM card_state ORDER BY card_id").map(
      (r) => r.card_id,
    );
  }

  /** Forget a schedule that no history supports any more. */
  deleteState(cardId: string): void {
    this.run("DELETE FROM card_state WHERE card_id = ?", cardId);
    this.run("UPDATE cards SET reviewed = 0 WHERE id = ?", cardId);
  }

  // -- meta ----------------------------------------------------------------

  getMeta(key: string): string | undefined {
    return this.one<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)?.value;
  }

  setMeta(key: string, value: string): void {
    this.run(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }

  // -- queue (section 9) ---------------------------------------------------

  dueCards(now: string, limit: number): DueRow[] {
    return this.many<DueRow>(
      `SELECT c.id, c.question, c.answer, c.context, c.file_path, c.line_no
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
      `SELECT id, question, answer, context, file_path, line_no
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
