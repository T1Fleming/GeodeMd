import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "./index.js";

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
