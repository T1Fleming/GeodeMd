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
/** `host`'s `COUNT_CAP` in production; an argument here, which is the point. */
const CAP = 10_000;
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

describe("the order cards are served in", () => {
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

  it("carries the path and line as data, not only as a display string", async () => {
    // The CLI opens the note in an editor, and re-parsing the locator to get
    // there would guess wrong on any path containing a colon.
    await write("algorithms/Sorting.md", "intro\nQ :: A\n");
    await core.sync(T0);
    const card = core.getDueCards(T0)[0]!;
    expect(card.filePath).toBe("algorithms/Sorting.md");
    expect(card.lineNo).toBe(2);
  });
});

describe("recording a review", () => {
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

describe("reporting what is due and what is new", () => {
  it("counts total, due now, due before local midnight, and new", async () => {
    await write("a.md", "A :: 1\nB :: 2\n");
    await core.sync(T0);
    await core.reviewCard("sr-000000000001", 1, T0);

    const s = core.stats(T0, CAP);
    expect(s.total).toBe(2);
    expect(s.newCards).toBe(1);
    // A lapsed card is due within the hour, so before midnight either way.
    expect(s.dueBeforeMidnight).toBeGreaterThanOrEqual(s.dueNow);
  });

  it("reports the counts as exact when nothing hit the cap", async () => {
    await write("a.md", "A :: 1\nB :: 2\n");
    await core.sync(T0);
    await core.reviewCard("sr-000000000001", 1, T0);
    expect(core.stats(T0, CAP).capped).toBe(false);
  });

  it("says so when a count stopped at the cap", async () => {
    // ADR 0024: counting what is due costs a probe per due row and counting
    // what is new costs an index entry each, so both stop at the cap and report
    // a floor rather than freezing the main process over a backlog. The cap is
    // an argument, which is what makes this a three-card test rather than a
    // ten-thousand-card one.
    await write("a.md", "A :: 1\nB :: 2\nC :: 3\n");
    await core.sync(T0);
    await core.reviewCard("sr-000000000001", 1, T0);
    await core.reviewCard("sr-000000000002", 1, T0);

    const later = new Date(T0.getTime() + 3_600_000);
    const s = core.stats(later, 2);
    expect(s.dueNow).toBe(2);
    expect(s.newCards).toBe(1);
    expect(s.capped).toBe(true);
    // The total is never capped: it is a fact about the collection.
    expect(s.total).toBe(3);

    // And with room to spare, every figure is exact and nothing claims a floor.
    expect(core.stats(later, CAP)).toMatchObject({ dueNow: 2, newCards: 1, capped: false });
  });

  it("does not count a deleted card's surviving state as due", async () => {
    // `card_state` outlives the card on purpose — that is what keeps a restored
    // card out of the new queue — so a count over `card_state` alone reports
    // cards that no longer exist. It showed up as a review header reading
    // "1 of 2 due" against a one-card database, and as due + new > total here.
    await write("a.md", "A :: 1\nB :: 2\n");
    await core.sync(T0);
    await core.reviewCard("sr-000000000001", 1, T0);
    expect(store.getState("sr-000000000001")).toBeDefined();

    const later = new Date(T0.getTime() + 3_600_000);
    await write("a.md", "B :: 2 <!-- sr-000000000002 -->\n");
    await core.sync(later);
    expect(store.getState("sr-000000000001")).toBeDefined();

    const s = core.stats(later, CAP);
    expect(s.total).toBe(1);
    expect(s.dueNow).toBe(0);
    expect(s.dueBeforeMidnight).toBe(0);
    expect(s.newCards).toBe(1);
    // The header the CLI prints is drawn from exactly this sum, so it has to
    // match what `getDueCards` can actually hand back.
    expect(s.dueNow + s.newCards).toBe(core.getDueCards(later, 50).length);
  });
});
