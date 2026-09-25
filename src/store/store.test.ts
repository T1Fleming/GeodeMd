import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "./index.js";
import type { CardState } from "./index.js";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "geode-store-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("opening the database", () => {
  it("creates the parent directory on a first run", async () => {
    // The XDG data dir will not exist the first time anyone runs this.
    const dbPath = path.join(dir, "nested", "deeper", "db.sqlite");
    const store = new Store(dbPath);
    store.close();
    await expect(fs.stat(dbPath)).resolves.toBeDefined();
  });

  it("keeps `files` a rowid table, which step 6's bitmap depends on", () => {
    const store = new Store(":memory:");
    store.upsertFile("a.md", 1, 2);
    expect(store.getFile("a.md")!.rowid).toBeGreaterThan(0);
    store.close();
  });

  it("stores `reviews` WITHOUT ROWID, so there is no ingest-order column", () => {
    const store = new Store(":memory:");
    const sql = (
      store.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'reviews'").get() as {
        sql: string;
      }
    ).sql;
    expect(sql).toContain("WITHOUT ROWID");
    store.close();
  });
});

/**
 * ADR 0024: a count of what is due costs a row probe per due card, so at a
 * million cards with a large backlog it froze the main process for a fifth of a
 * second. The limit is what bounds that, and it has to actually stop the scan.
 */
describe("counting what is due", () => {
  const state = (due: string): CardState => ({
    due,
    stability: 1,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    state: 2,
    last_review: "2026-09-01T00:00:00.000Z",
    learning_steps: 0,
  });

  function seed(store: Store, n: number): void {
    store.transaction(() => {
      for (let i = 0; i < n; i++) {
        const id = `sr-${String(i).padStart(12, "0")}`;
        store.upsertCard({ id, file_path: "a.md", line_no: i, question: "Q", answer: "A" });
        store.putState(id, state("2026-09-01T00:00:00.000Z"));
      }
    });
  }

  it("stops at the limit rather than counting a backlog out", () => {
    const store = new Store(":memory:");
    seed(store, 10);
    const now = "2026-09-02T00:00:00.000Z";
    expect(store.countDue(now, 100)).toBe(10);
    expect(store.countDue(now, 4)).toBe(4);
    // The forecast count is the same query against a later instant.
    expect(store.countDueBefore(now, 4)).toBe(4);
    store.close();
  });

  it("still ignores state that outlived its card", () => {
    // The reason the count joins `cards` at all, and the reason it costs a
    // probe per row. A LIMIT must not become a shortcut past this.
    const store = new Store(":memory:");
    seed(store, 3);
    store.deleteVanishedInFile("a.md", []);
    expect(store.countDue("2026-09-02T00:00:00.000Z", 100)).toBe(0);
    store.close();
  });
});

describe("checkpointing", () => {
  it("folds the write-ahead log back into the database", async () => {
    // A sync of a large collection leaves a large WAL, and SQLite folds it in on
    // whichever write comes next — which in a session is the user's first
    // rating (ADR 0024). Doing it deliberately is what moves that cost off a
    // keypress.
    const dbPath = path.join(dir, "wal.sqlite");
    const store = new Store(dbPath);
    store.transaction(() => {
      for (let i = 0; i < 2000; i++) {
        store.upsertCard({
          id: `sr-${String(i).padStart(12, "0")}`,
          file_path: "a.md",
          line_no: i,
          question: "Q".repeat(200),
          answer: "A".repeat(200),
        });
      }
    });

    expect((await fs.stat(`${dbPath}-wal`)).size).toBeGreaterThan(0);

    const r = store.checkpoint();
    expect(r.busy).toBe(0);
    expect(r.checkpointed).toBeGreaterThan(0);
    // Every frame back-filled, which is the state a rating should find the
    // database in rather than paying for a sync's worth of pages. (The two
    // figures are the WAL's size and how much of it has been folded in — not
    // work done by this call, which is why the equality is the assertion.)
    expect(r.checkpointed).toBe(r.log);
    store.close();
  });

  it("is harmless with nothing to fold", () => {
    const store = new Store(":memory:");
    expect(() => store.checkpoint()).not.toThrow();
    store.close();
  });
});
