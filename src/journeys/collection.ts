/**
 * A real collection in a temp directory, for the journeys to walk.
 *
 * Deliberately closer to the real thing than the unit tests' harnesses are: a
 * **file-backed** database rather than `:memory:`, because two of these journeys
 * are about the database being a file you can delete, and an in-memory one cannot
 * be deleted or reopened. The cost is a few milliseconds per journey, and the
 * tier is small on purpose.
 *
 * `newId` is sequential so a journey can name a card it has not read yet; the
 * clock is passed in by each test, as everywhere else.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Core } from "../core/index.js";
import { Store } from "../store/index.js";

export interface Collection {
  /** The notes directory — what a user would point GeodeMD at. */
  notes: string;
  /** Where the cache lives. A path, so a journey can delete it. */
  dbPath: string;
  core: Core;
  /** Write a note, backdated so the sync does not defer it as freshly edited. */
  write(rel: string, body: string): Promise<void>;
  read(rel: string): Promise<string>;
  /** Reopen the database from disk — what starting the program again does. */
  reopen(): Promise<void>;
  close(): Promise<void>;
}

/** Old enough that the two-second deferral window never applies. */
const MTIME = new Date("2026-09-01T00:00:00.000Z");

export async function newCollection(device = "journey"): Promise<Collection> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "geode-journey-"));
  const notes = path.join(root, "notes");
  const dbPath = path.join(root, "cache", "db.sqlite");
  await fs.mkdir(notes, { recursive: true });

  let n = 0;
  const config = {
    notesPath: notes,
    device,
    dbPath,
    newId: () => `sr-${String(++n).padStart(12, "0")}`,
  };

  let store = new Store(dbPath);
  const it: Collection = {
    notes,
    dbPath,
    core: new Core(config, store),
    async write(rel, body) {
      const abs = path.join(notes, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, body, "utf8");
      await fs.utimes(abs, MTIME, MTIME);
    },
    async read(rel) {
      return fs.readFile(path.join(notes, rel), "utf8");
    },
    async reopen() {
      store.close();
      store = new Store(dbPath);
      it.core = new Core(config, store);
    },
    async close() {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
  return it;
}
