import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Core } from "./index.js";
import { Store } from "../store/index.js";

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

describe("rebuild", () => {
  it("reproduces cards, files, reviews and card_state IDENTICALLY, in full", async () => {
    await write("a.md", "A :: 1\nB :: 2\n");
    await write("sub/c.md", "C :: 3\n");
    await core.sync(T0);

    await core.reviewCard("sr-000000000001", 3, new Date("2026-09-02T13:00:00.000Z"));
    await core.reviewCard("sr-000000000002", 1, new Date("2026-09-02T13:01:00.000Z"));
    await core.reviewCard("sr-000000000001", 4, new Date("2026-09-03T13:00:00.000Z"));

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

describe("log ingest", () => {
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
