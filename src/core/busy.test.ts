/**
 * The `SQLITE_BUSY` path, against a genuinely busy database.
 *
 * `isBusy` has unit tests and `cards/review` returns `{ applied: "log-only" }`
 * when it fires, but until this file nothing had exercised it with a real
 * concurrent writer — so the design's central promise was, strictly, untested:
 *
 *   the rating is `fsync`ed to the log BEFORE SQLite is touched, so a busy
 *   database costs the user a dim note and an advancing card, never a dialog
 *   and never a lost review.
 *
 * With two interfaces over one database this stops being exotic. ADR 0013
 * calls a `geode sync` running in a terminal while the app is open an
 * "ordinary Tuesday", and that is exactly when a write lock is held.
 *
 * The blocker is a second `Store` on the same file holding an `IMMEDIATE`
 * transaction — a real write lock taken by a separate connection, which is
 * what a concurrent sync does.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Core } from "./index.js";
import { Store } from "../store/index.js";
import { isBusy } from "../host/errors.js";

let dir: string;
let notes: string;
let dbPath: string;
let store: Store;
let core: Core;
let blocker: Store | null;
let idCounter = 0;

const MTIME = new Date("2026-09-01T00:00:00.000Z");
const T0 = new Date("2026-09-02T12:00:00.000Z");

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "geode-busy-"));
  notes = path.join(dir, "notes");
  dbPath = path.join(dir, "db.sqlite");
  await fs.mkdir(notes, { recursive: true });
  idCounter = 0;

  // A real file, not `:memory:` — two connections cannot contend over an
  // in-memory database, so the whole point would be lost.
  store = new Store(dbPath);
  // Five seconds is right in production and wrong in a test: what is under
  // test is what happens when the timeout EXPIRES, not how long it waits.
  store.db.pragma("busy_timeout = 50");
  core = new Core(
    {
      notesPath: notes,
      device: "test",
      dbPath,
      newId: () => `sr-${String(++idCounter).padStart(12, "0")}`,
    },
    store,
  );
  blocker = null;
});

afterEach(async () => {
  try {
    blocker?.db.exec("ROLLBACK");
  } catch {
    // Already rolled back by a test; nothing to undo.
  }
  blocker?.close();
  store.close();
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(notes, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  await fs.utimes(abs, MTIME, MTIME);
}

/** Take a write lock from another connection and hold it. */
function holdWriteLock(): void {
  blocker = new Store(dbPath);
  blocker.db.exec("BEGIN IMMEDIATE");
}

function releaseWriteLock(): void {
  blocker!.db.exec("ROLLBACK");
  blocker!.close();
  blocker = null;
}

async function oneCard(): Promise<string> {
  await write("a.md", "Q :: A\n");
  await core.sync(T0, {});
  const [card] = core.getDueCards(T0, 1);
  return card!.id;
}

describe("a review while another writer holds the lock", () => {
  it("fails in the way the app is written to expect", async () => {
    const id = await oneCard();
    holdWriteLock();

    // Not just "it throws" — it must throw something `isBusy` recognises, or
    // the app classifies a busy database as an internal error and shows a
    // dialog for a situation that is not a failure.
    const err = await core.reviewCard(id, 3, T0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isBusy(err)).toBe(true);
  });

  it("has already made the rating durable before SQLite is touched", async () => {
    const id = await oneCard();
    holdWriteLock();
    await core.reviewCard(id, 3, T0).catch(() => undefined);

    // The log is the durable store; the database is a cache. If the ordering
    // were ever reversed, this is the assertion that would catch it.
    const shardDir = path.join(notes, ".sr", "log");
    const shards = await fs.readdir(shardDir);
    expect(shards).toHaveLength(1);
    const body = await fs.readFile(path.join(shardDir, shards[0]!), "utf8");
    expect(body).toContain(id);
    expect(JSON.parse(body.trim()) as { rating: number }).toMatchObject({ rating: 3 });
  });

  it("leaves the card's state untouched rather than half-written", async () => {
    const id = await oneCard();
    holdWriteLock();
    await core.reviewCard(id, 3, T0).catch(() => undefined);

    // The write is one transaction, so a busy failure is all-or-nothing: no
    // review row without the state that goes with it.
    expect(store.getState(id)).toBeUndefined();
    expect(core.stats(T0).newCards).toBe(1);
  });

  it("is repaired by the next ingest, with nothing lost", async () => {
    const id = await oneCard();
    holdWriteLock();
    await core.reviewCard(id, 3, T0).catch(() => undefined);
    releaseWriteLock();

    // This is the promise the design rests on: the rating survives in the log
    // and the database catches up on its own.
    await core.ingestLogs(T0);
    const state = store.getState(id);
    expect(state).toBeDefined();
    expect(state!.reps).toBe(1);
    expect(core.stats(T0).newCards).toBe(0);
  });

  it("does not duplicate the review when the ingest replays it", async () => {
    const id = await oneCard();
    holdWriteLock();
    await core.reviewCard(id, 3, T0).catch(() => undefined);
    releaseWriteLock();

    // `(card_id, rated_at)` is what makes re-ingesting a shard a no-op. Without
    // it the repair above would count the rating twice.
    await core.ingestLogs(T0);
    await core.ingestLogs(T0);
    expect(store.getState(id)!.reps).toBe(1);
  });

  it("succeeds normally once the lock is released", async () => {
    const id = await oneCard();
    holdWriteLock();
    await core.reviewCard(id, 3, T0).catch(() => undefined);
    releaseWriteLock();

    // Resolves with the new state — which is also how a caller knows the
    // scheduler wants this card again in ten minutes (ADR 0023).
    const next = await core.reviewCard(id, 3, T0);
    expect(next.due).toBe(store.getState(id)!.due);
  });
});
