import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import Database from "better-sqlite3";
import { Core } from "./index.js";
import { Store } from "../store/index.js";
import type { CardState } from "../store/index.js";
import { FsrsScheduler, SCHEDULER_VERSION, fold } from "../scheduler/index.js";
import type { Scheduler } from "../scheduler/index.js";

/**
 * Spec section 10: "Rebuild" — the one test that protects the durability claim,
 * plus the log-ingest behaviour it depends on.
 */

let notes: string;
let store: Store;
let core: Core;
let idCounter: number;

const MTIME = new Date("2026-09-01T00:00:00.000Z");
const T0 = new Date("2026-09-02T12:00:00.000Z");

function nextId(): string {
  idCounter++;
  return `sr-${String(idCounter).padStart(12, "0")}`;
}

beforeEach(async () => {
  notes = await fs.mkdtemp(path.join(os.tmpdir(), "geode-rebuild-"));
  store = new Store(":memory:");
  idCounter = 0;
  core = new Core({ notesPath: notes, device: "test", dbPath: ":memory:", newId: nextId }, store);
});

afterEach(async () => {
  store.close();
  await fs.rm(notes, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(notes, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  await fs.utimes(abs, MTIME, MTIME);
}

/** Everything in the database, for a total comparison. */
function dump(s: Store): Record<string, unknown[]> {
  const q = (sql: string) => s.db.prepare(sql).all() as unknown[];
  return {
    cards: q("SELECT * FROM cards ORDER BY id"),
    files: q("SELECT path, mtime_ms, size FROM files ORDER BY path"),
    reviews: q("SELECT * FROM reviews ORDER BY card_id, rated_at"),
    card_state: q("SELECT * FROM card_state ORDER BY card_id"),
  };
}

async function logLine(name: string, obj: unknown): Promise<void> {
  const dir = path.join(notes, ".sr", "log");
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(path.join(dir, name), `${JSON.stringify(obj)}\n`, "utf8");
}

describe("rebuilding from notes and logs", () => {
  it("reproduces cards, files, reviews and card_state IDENTICALLY, in full", async () => {
    await write("a.md", "A :: 1\nB :: 2\n");
    await write("sub/c.md", "C :: 3\n");
    await core.sync(T0);

    await core.reviewCard("sr-000000000001", 3, new Date("2026-09-02T13:00:00.000Z"));
    await core.reviewCard("sr-000000000002", 1, new Date("2026-09-02T13:01:00.000Z"));
    await core.reviewCard("sr-000000000001", 4, new Date("2026-09-03T13:00:00.000Z"));
    // Left on FSRS-6's second learning step, so `learning_steps` is compared
    // at a value its default could not produce by accident.
    await core.reviewCard("sr-000000000003", 3, new Date("2026-09-03T13:05:00.000Z"));
    expect(store.getState("sr-000000000003")!.learning_steps).toBe(1);

    const before = dump(store);

    // Delete the database entirely.
    await core.rebuild(new Date("2026-09-04T12:00:00.000Z"));

    // No column is exempt and no row set is scoped. That total assertion is
    // what removing created_at / missing_since / deleted_at bought.
    expect(dump(store)).toEqual(before);
  });

  it("is a differential test between fold-forward and from-scratch replay", async () => {
    // The pre-rebuild state was built incrementally (reviewCard folds forward);
    // the rebuild replays each history from zero. Section 8 step 7 says this
    // test already keeps the two strategies agreeing, with nothing added.
    await write("a.md", "A :: 1\n");
    await core.sync(T0);
    const id = "sr-000000000001";
    for (let d = 0; d < 5; d++) {
      await core.reviewCard(id, 3, new Date(Date.UTC(2026, 8, 2 + d, 13)));
    }
    const incremental = store.getState(id)!;

    await core.rebuild(new Date("2026-09-20T12:00:00.000Z"));
    expect(store.getState(id)).toEqual(incremental);
  });

  it("catches cards.reviewed drifting out of agreement with card_state", async () => {
    await write("a.md", "A :: 1\nB :: 2\n");
    await core.sync(T0);
    await core.reviewCard("sr-000000000001", 3, T0);

    await core.rebuild(new Date("2026-09-05T12:00:00.000Z"));
    expect(store.getCard("sr-000000000001")!.reviewed).toBe(1);
    expect(store.getCard("sr-000000000002")!.reviewed).toBe(0);
  });

  it("a card authored while the database was gone still gets its id", async () => {
    // rebuild runs steps 1-7, stamp writes included.
    await write("a.md", "A :: 1\n");
    await core.rebuild(T0);
    expect(store.countCards()).toBe(1);
    expect(await fs.readFile(path.join(notes, "a.md"), "utf8")).toContain("<!-- sr-");
  });
});

describe("ingesting the log", () => {
  it("ingesting the same log twice changes nothing", async () => {
    await write("a.md", "A :: 1\n");
    await core.sync(T0);
    await core.reviewCard("sr-000000000001", 3, T0);

    const before = dump(store);
    await core.ingestLogs(T0);
    await core.ingestLogs(T0);
    expect(dump(store)).toEqual(before);
    expect(store.countReviews()).toBe(1);
  });

  it("merges two shards in timestamp order regardless of read order", async () => {
    await write("a.md", "A :: 1\n");
    await core.sync(T0);
    const id = "sr-000000000001";

    // Written so that the alphabetically-later file holds the EARLIER review.
    await logLine("zzz-2026-09.jsonl", { card: id, at: "2026-09-02T10:00:00.000Z", rating: 3 });
    await logLine("aaa-2026-09.jsonl", { card: id, at: "2026-09-02T11:00:00.000Z", rating: 3 });
    await core.ingestLogs(new Date("2026-09-03T00:00:00.000Z"));

    const viaTwoShards = store.getState(id)!;

    // Now the same two reviews as one chronological history, rebuilt.
    await core.rebuild(new Date("2026-09-03T00:00:00.000Z"));
    expect(store.getState(id)).toEqual(viaTwoShards);
    expect(store.countReviews()).toBe(2);
  });

  it("a review arriving OUT OF ORDER replays in rated_at order, not ingest order", async () => {
    await write("a.md", "A :: 1\n");
    await core.sync(T0);
    const id = "sr-000000000001";

    // Newer review lands first...
    await logLine("m-2026-09.jsonl", { card: id, at: "2026-09-05T10:00:00.000Z", rating: 3 });
    await core.ingestLogs(new Date("2026-09-06T00:00:00.000Z"));
    // ...then an older one arrives from a machine that was offline.
    await logLine("m-2026-09.jsonl", { card: id, at: "2026-09-03T10:00:00.000Z", rating: 1 });
    await core.ingestLogs(new Date("2026-09-06T00:00:00.000Z"));

    const outOfOrder = store.getState(id)!;

    // Identical to replaying the same two reviews chronologically from zero.
    await core.rebuild(new Date("2026-09-06T00:00:00.000Z"));
    expect(store.getState(id)).toEqual(outOfOrder);
    expect(store.countReviews()).toBe(2);
  });

  it("ingests a review for an id no longer in the notes without error", async () => {
    // Reviews outlive cards.
    await logLine("m-2026-09.jsonl", {
      card: "sr-gonegonegone",
      at: "2026-09-02T10:00:00.000Z",
      rating: 3,
    });
    const r = await core.ingestLogs(T0);
    expect(r.reviewsIngested).toBe(1);
    expect(store.getState("sr-gonegonegone")).toBeUndefined();
  });

  it("skips a truncated final line rather than aborting the ingest", async () => {
    await write("a.md", "A :: 1\n");
    await core.sync(T0);
    const id = "sr-000000000001";

    const file = path.join(notes, ".sr", "log", "m-2026-09.jsonl");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      `${JSON.stringify({ card: id, at: "2026-09-02T10:00:00.000Z", rating: 3 })}\n{"card":"sr-`,
      "utf8",
    );

    const r = await core.ingestLogs(T0);
    expect(r.reviewsIngested).toBe(1);
    expect(store.countReviews()).toBe(1);
  });

  it("completes a truncated line on the following run", async () => {
    // The offset never advanced past the partial line, so the completed line is
    // picked up in full — the crash log-write-first ordering exists to survive.
    await write("a.md", "A :: 1\n");
    await core.sync(T0);
    const id = "sr-000000000001";
    const file = path.join(notes, ".sr", "log", "m-2026-09.jsonl");
    await fs.mkdir(path.dirname(file), { recursive: true });

    const full = `${JSON.stringify({ card: id, at: "2026-09-02T10:00:00.000Z", rating: 3 })}\n`;
    await fs.writeFile(file, full.slice(0, 20), "utf8");
    expect((await core.ingestLogs(T0)).reviewsIngested).toBe(0);

    await fs.writeFile(file, full, "utf8");
    expect((await core.ingestLogs(T0)).reviewsIngested).toBe(1);
  });

  it("a copy of a shard under a different name ingests zero new reviews", async () => {
    await write("a.md", "A :: 1\n");
    await core.sync(T0);
    await core.reviewCard("sr-000000000001", 3, T0);

    const dir = path.join(notes, ".sr", "log");
    const [original] = await fs.readdir(dir);
    await fs.copyFile(path.join(dir, original!), path.join(dir, "restored-backup.jsonl"));

    const r = await core.ingestLogs(T0);
    expect(r.reviewsIngested).toBe(0);
    expect(store.countReviews()).toBe(1);
  });

  it("does not open a frozen shard whose size is unchanged", async () => {
    await write("a.md", "A :: 1\n");
    await core.sync(T0);
    await core.reviewCard("sr-000000000001", 3, T0);
    await core.ingestLogs(T0);

    const r = await core.ingestLogs(T0);
    expect(r.shardsSkipped).toBe(1);
    expect(r.bytesRead).toBe(0);
  });

  it("reads only the appended bytes when a shard grows", async () => {
    await write("a.md", "A :: 1\nB :: 2\n");
    await core.sync(T0);
    await core.reviewCard("sr-000000000001", 3, T0);
    await core.ingestLogs(T0);

    await core.reviewCard("sr-000000000002", 3, new Date(T0.getTime() + 1000));
    const r = await core.ingestLogs(T0);
    expect(r.shardsSkipped).toBe(0);
    expect(r.bytesRead).toBeGreaterThan(0);
    expect(r.bytesRead).toBeLessThan(200); // one line, not the whole shard
  });

  it("re-reads from zero when a shard shrank", async () => {
    await write("a.md", "A :: 1\n");
    await core.sync(T0);
    const id = "sr-000000000001";
    await logLine("m-2026-09.jsonl", { card: id, at: "2026-09-02T10:00:00.000Z", rating: 3 });
    await logLine("m-2026-09.jsonl", { card: id, at: "2026-09-02T11:00:00.000Z", rating: 3 });
    await core.ingestLogs(T0);
    expect(store.countReviews()).toBe(2);

    // Truncated and replaced by something shorter.
    const file = path.join(notes, ".sr", "log", "m-2026-09.jsonl");
    await fs.writeFile(
      file,
      `${JSON.stringify({ card: id, at: "2026-09-02T09:00:00.000Z", rating: 2 })}\n`,
      "utf8",
    );

    const r = await core.ingestLogs(T0);
    expect(r.reviewsIngested).toBe(1); // the new line, re-read from zero
    expect(store.countReviews()).toBe(3);
  });

  it("counts an unparseable line as skipped, never fatal", async () => {
    await logLine("m-2026-09.jsonl", { card: "sr-aaaaaaaaaaaa", at: "x", rating: 3 });
    const dir = path.join(notes, ".sr", "log");
    await fs.appendFile(path.join(dir, "m-2026-09.jsonl"), "not json at all\n", "utf8");

    const r = await core.ingestLogs(T0);
    expect(r.linesSkipped).toBe(1);
    expect(r.reviewsIngested).toBe(1);
  });
});

describe("annotations and the database", () => {
  it("stay out of it: a rebuild with annotations present reproduces it identically", async () => {
    // Annotations are files under `.sr/annotations/` and nothing else (ADR
    // 0029). If one ever reached a table, this total comparison would still
    // pass only by accident — so the annotation is written BEFORE the first
    // dump, and must survive the rebuild untouched as well.
    await write("a.md", "A :: 1\nB :: 2\n");
    await core.sync(T0);
    await core.reviewCard("sr-000000000001", 3, new Date("2026-09-02T13:00:00.000Z"));
    await core.setAnnotation("sr-000000000001", "remember :: this is not a card\n");
    await core.setAnnotation("sr-000000000002", "second\r\n");

    const before = dump(store);
    await core.rebuild(new Date("2026-09-04T12:00:00.000Z"));
    expect(dump(store)).toEqual(before);
    expect(await core.getAnnotation("sr-000000000001")).toBe("remember :: this is not a card\n");
    expect(await core.getAnnotation("sr-000000000002")).toBe("second\r\n");
  });
});

/**
 * ADR 0028. `card_state` is a fold under one scheduler; a database derived by
 * another is re-derived when it is opened, rather than left to mix the two.
 */
describe("a database scheduled by a different scheduler", () => {
  /** The real scheduler, answering differently and calling itself something else. */
  class Elsewhere implements Scheduler {
    readonly version = "some other scheduler";
    private readonly real = new FsrsScheduler();
    initial(now: Date): CardState {
      return this.real.initial(now);
    }
    next(state: CardState, rating: 1 | 2 | 3 | 4, now: Date): CardState {
      const n = this.real.next(state, rating, now);
      const later = new Date(new Date(n.due).getTime() + 86_400_000).toISOString();
      return { ...n, due: later, stability: n.stability * 2 };
    }
  }

  const cfg = () => ({ notesPath: notes, device: "test", dbPath: ":memory:", newId: nextId });

  async function scheduledElsewhere(): Promise<void> {
    const old = new Core(cfg(), store, new Elsewhere());
    await write("a.md", "A :: 1\nB :: 2\n");
    await old.sync(T0);
    await old.adoptScheduler(T0);
    await old.reviewCard("sr-000000000001", 3, new Date("2026-09-02T13:00:00.000Z"));
    await old.reviewCard("sr-000000000001", 3, new Date("2026-09-02T13:10:00.000Z"));
    await old.reviewCard("sr-000000000002", 1, new Date("2026-09-02T13:01:00.000Z"));
  }

  it("re-derives every schedule to exactly what a rebuild produces", async () => {
    await scheduledElsewhere();
    const r = await core.adoptScheduler(T0);
    expect(r).toEqual({ from: "some other scheduler", to: SCHEDULER_VERSION, cards: 2 });
    const adopted = dump(store);

    await core.rebuild(new Date("2026-09-04T12:00:00.000Z"));
    expect(dump(store)).toEqual(adopted);
  });

  it("records the scheduler, so the next open does nothing and writes nothing", async () => {
    await scheduledElsewhere();
    await core.adoptScheduler(T0);
    const writes = store.totalChanges();
    expect(await core.adoptScheduler(T0)).toBeNull();
    expect(store.totalChanges()).toBe(writes);
  });

  it("reaches the schedule of a card whose line is gone, so a restored card comes back right", async () => {
    await scheduledElsewhere();
    await write("a.md", "B :: 2 <!-- sr-000000000002 -->\n");
    await core.sync(new Date("2026-09-03T00:00:00.000Z"));
    expect(store.getCard("sr-000000000001")).toBeUndefined();

    await core.adoptScheduler(T0);
    const fresh = fold(new FsrsScheduler(), null, store.historyOf("sr-000000000001"), T0);
    expect(store.getState("sr-000000000001")).toEqual(fresh);
  });

  it("says nothing about a new database, and records the scheduler all the same", async () => {
    expect(await core.adoptScheduler(T0)).toBeNull();
    expect(store.getMeta("scheduler")).toBe(SCHEDULER_VERSION);
  });

  it("leaves the old scheduler recorded until the last schedule is re-derived", async () => {
    // Enough schedules for more than one batch, and a look between batches: a
    // run cut short there must not look finished to the next open.
    await scheduledElsewhere();
    const elsewhere = new Elsewhere();
    store.transaction(() => {
      for (let i = 0; i < 2500; i++) {
        const id = `sr-x${String(i).padStart(11, "0")}`;
        store.insertReview(id, "2026-09-02T13:00:00.000Z", 3);
        store.putState(id, elsewhere.next(elsewhere.initial(T0), 3, T0));
      }
    });
    // The first batch runs before the first yield, so this looks between the
    // first batch and the second.
    const adopting = core.adoptScheduler(T0);
    expect(store.getMeta("scheduler")).toBe("some other scheduler");
    expect((await adopting)?.cards).toBe(2502);
    expect(store.getMeta("scheduler")).toBe(SCHEDULER_VERSION);
  });

  it("is recorded by a rebuild, which derives everything with the scheduler running", async () => {
    await scheduledElsewhere();
    await core.rebuild(T0);
    expect(store.getMeta("scheduler")).toBe(SCHEDULER_VERSION);
    expect(await core.adoptScheduler(T0)).toBeNull();
  });
});

/** What ts-fsrs 4.6.1 wrote for a new card rated good: ten minutes out, Learning. */
const FSRS5_SCHEMA_AND_ROW = [
  `CREATE TABLE cards (id TEXT PRIMARY KEY, file_path TEXT NOT NULL, line_no INTEGER,
     question TEXT NOT NULL, answer TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'basic',
     reviewed INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE reviews (card_id TEXT NOT NULL, rated_at TEXT NOT NULL, rating INTEGER NOT NULL,
     PRIMARY KEY (card_id, rated_at)) WITHOUT ROWID`,
  `CREATE TABLE card_state (card_id TEXT PRIMARY KEY, due TEXT NOT NULL, stability REAL,
     difficulty REAL, reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0,
     state INTEGER NOT NULL, last_review TEXT)`,
  `INSERT INTO cards VALUES ('sr-000000000001', 'a.md', 1, 'A', '1', 'basic', 1)`,
  `INSERT INTO reviews VALUES ('sr-000000000001', '2026-09-02T13:00:00.000Z', 3)`,
  `INSERT INTO card_state VALUES ('sr-000000000001', '2026-09-02T13:10:00.000Z',
     3.173, 5.28243442, 1, 0, 1, '2026-09-02T13:00:00.000Z')`,
];

/**
 * The databases ts-fsrs 4 wrote have no `learning_steps` column and no record
 * of the scheduler. They must still open, and be re-derived before anything
 * reads them.
 */
describe("a database from before FSRS-6", () => {
  it("opens, gains the column, and has every schedule re-derived", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geode-fsrs5-"));
    const dbPath = path.join(dir, "db.sqlite");
    try {
      const old = new Database(dbPath);
      for (const sql of FSRS5_SCHEMA_AND_ROW) old.exec(sql);
      old.close();

      const upgraded = new Store(dbPath);
      try {
        const c = new Core({ notesPath: notes, device: "test", dbPath, newId: nextId }, upgraded);
        expect(await c.adoptScheduler(T0)).toEqual({ from: null, to: SCHEDULER_VERSION, cards: 1 });
        const s = upgraded.getState("sr-000000000001")!;
        expect(s.learning_steps).toBe(1);
        expect(s.stability).not.toBe(3.173);
        expect(s).toEqual(
          fold(new FsrsScheduler(), null, upgraded.historyOf("sr-000000000001"), T0),
        );
      } finally {
        upgraded.close();
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
