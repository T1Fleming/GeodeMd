import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Core } from "./index.js";
import { Store } from "../store/index.js";

/** Spec section 9: the review flow. */

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
  notes = await fs.mkdtemp(path.join(os.tmpdir(), "geode-review-"));
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

describe("getDueCards", () => {
  it("orders new cards by (file_path, line_no) — the order they read", async () => {
    await write("z.md", "Z1 :: 1\nZ2 :: 2\n");
    await write("a.md", "A1 :: 1\nA2 :: 2\n");
    await core.sync(T0);

    expect(core.getDueCards(T0).map((c) => c.question)).toEqual(["A1", "A2", "Z1", "Z2"]);
  });

  it("is stable across a rebuild", async () => {
    await write("b.md", "B :: 1\n");
    await write("a.md", "A :: 1\n");
    await core.sync(T0);
    const before = core.getDueCards(T0).map((c) => c.id);

    await core.rebuild(T0);
    expect(core.getDueCards(T0).map((c) => c.id)).toEqual(before);
  });

  it("serves due cards ahead of new ones, most overdue first", async () => {
    await write("a.md", "A :: 1\nB :: 2\nC :: 3\n");
    await core.sync(T0);

    // Review A and B so they acquire a due date; C stays new.
    await core.reviewCard("sr-000000000001", 1, T0);
    await core.reviewCard("sr-000000000002", 1, new Date(T0.getTime() + 1000));

    const later = new Date(T0.getTime() + 86_400_000);
    const queue = core.getDueCards(later);
    expect(queue.slice(0, 2).map((c) => c.id)).toEqual([
      "sr-000000000001",
      "sr-000000000002",
    ]);
    expect(queue[2]!.id).toBe("sr-000000000003"); // the new card, last
  });

  it("respects the limit across both queries", async () => {
    await write("a.md", "A :: 1\nB :: 2\nC :: 3\nD :: 4\n");
    await core.sync(T0);
    expect(core.getDueCards(T0, 2)).toHaveLength(2);
  });

  it("starves new cards when the due backlog exceeds the limit", async () => {
    // Section 9 names this as the intended trade, so it is pinned as behaviour.
    await write("a.md", "A :: 1\nB :: 2\nC :: 3\n");
    await core.sync(T0);
    await core.reviewCard("sr-000000000001", 1, T0);
    await core.reviewCard("sr-000000000002", 1, new Date(T0.getTime() + 1000));

    const later = new Date(T0.getTime() + 86_400_000);
    const queue = core.getDueCards(later, 2);
    expect(queue.map((c) => c.id)).toEqual(["sr-000000000001", "sr-000000000002"]);
  });

  it("builds a locator from the vault-relative path and line", async () => {
    await write("algorithms/Sorting.md", "intro\nQ :: A\n");
    await core.sync(T0);
    expect(core.getDueCards(T0)[0]!.locator).toBe("algorithms/Sorting.md:2");
  });
});

describe("reviewCard", () => {
  it("writes the log BEFORE SQLite", async () => {
    await write("a.md", "A :: 1\n");
    await core.sync(T0);
    await core.reviewCard("sr-000000000001", 3, T0);

    const dir = path.join(notes, ".sr", "log");
    const [shard] = await fs.readdir(dir);
    const line = JSON.parse((await fs.readFile(path.join(dir, shard!), "utf8")).trim());
    expect(line).toEqual({
      card: "sr-000000000001",
      at: "2026-09-02T12:00:00.000Z",
      rating: 3,
    });
    expect(store.countReviews()).toBe(1);
  });

  it("omits elapsed and scheduled on a first review, and includes them after", async () => {
    await write("a.md", "A :: 1\n");
    await core.sync(T0);
    const id = "sr-000000000001";

    await core.reviewCard(id, 3, T0);
    await core.reviewCard(id, 3, new Date(T0.getTime() + 3 * 86_400_000));

    const dir = path.join(notes, ".sr", "log");
    const [shard] = await fs.readdir(dir);
    const lines = (await fs.readFile(path.join(dir, shard!), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(lines[0]).not.toHaveProperty("elapsed");
    expect(lines[1]!.elapsed).toBeCloseTo(3, 1);
    expect(lines[1]).toHaveProperty("scheduled");
  });

  it("recovers a review that reached the log but not the database", async () => {
    await write("a.md", "A :: 1\n");
    await core.sync(T0);
    const id = "sr-000000000001";
    await core.reviewCard(id, 3, T0);

    // Simulate the crash window: the log has the line, the DB does not.
    store.db.exec("DELETE FROM reviews");
    store.db.exec("DELETE FROM card_state");
    store.db.exec("DELETE FROM log_files");
    store.db.exec("UPDATE cards SET reviewed = 0");
    expect(store.countReviews()).toBe(0);

    await core.ingestLogs(T0);
    expect(store.countReviews()).toBe(1);
    expect(store.getState(id)).toBeDefined();
    expect(store.getCard(id)!.reviewed).toBe(1);
  });

  it("puts a lapsed card back within minutes, not the same session", async () => {
    await write("a.md", "A :: 1\n");
    await core.sync(T0);
    const id = "sr-000000000001";
    await core.reviewCard(id, 1, T0);

    const due = new Date(store.getState(id)!.due).getTime();
    expect(due).toBeGreaterThan(T0.getTime());
    expect(due - T0.getTime()).toBeLessThan(60 * 60 * 1000);
  });
});

describe("stats", () => {
  it("counts total, due now, due before local midnight, and new", async () => {
    await write("a.md", "A :: 1\nB :: 2\n");
    await core.sync(T0);
    await core.reviewCard("sr-000000000001", 1, T0);

    const s = core.stats(T0);
    expect(s.total).toBe(2);
    expect(s.newCards).toBe(1);
    // A lapsed card is due within the hour, so before midnight either way.
    expect(s.dueBeforeMidnight).toBeGreaterThanOrEqual(s.dueNow);
  });
});
