/**
 * The implicit ingest, which the app did not do until the CLI stopped doing it
 * for it (ADR 0025).
 *
 * The failure this prevents is silent and looks like a scheduling bug: you
 * answer a card on the laptop, the syncer delivers its log shard, and the
 * desktop offers you the same card again because nothing told it to read the
 * log. `runs.test.ts`-style — a real `Core`, a real temp collection, no mocks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Core } from "../../core/index.js";
import { Store } from "../../store/index.js";
import { appendLog, formatAt } from "../../files/index.js";
import { counts, dueCards } from "./reads.js";

const T0 = new Date("2026-09-22T12:00:00.000Z");
const MTIME = new Date("2026-09-01T00:00:00.000Z");

let notes: string;
let store: Store;
let core: Core;

beforeEach(async () => {
  notes = await fs.mkdtemp(path.join(os.tmpdir(), "geode-reads-"));
  store = new Store(":memory:");
  let n = 0;
  core = new Core(
    {
      notesPath: notes,
      device: "desktop",
      dbPath: ":memory:",
      newId: () => `sr-${String(++n).padStart(12, "0")}`,
    },
    store,
  );
  const abs = path.join(notes, "a.md");
  await fs.writeFile(abs, "Q1 :: A1\nQ2 :: A2\n", "utf8");
  await fs.utimes(abs, MTIME, MTIME);
  await core.sync(T0);
});

afterEach(async () => {
  store.close();
  await fs.rm(notes, { recursive: true, force: true });
});

/** A review recorded by another device, arriving as a log shard would. */
async function answeredElsewhere(cardId: string, at: Date): Promise<void> {
  await appendLog(notes, "laptop", { card: cardId, at: formatAt(at), rating: 3 });
}

describe("reading the queue", () => {
  it("picks up a review another machine already recorded", async () => {
    const before = await dueCards(core, T0, 10);
    expect(before).toHaveLength(2);

    await answeredElsewhere(before[0]!.id, T0);

    // No sync, no rebuild: opening the Review tab is enough.
    const after = await dueCards(core, T0, 10);
    expect(after.map((c) => c.id)).toEqual([before[1]!.id]);
  });

  it("repairs the gap a crash leaves between the log and the database", async () => {
    // A rating is fsynced to the log before SQLite is touched, so a crash in
    // between leaves the log ahead by one. This is what closes it.
    const [card] = await dueCards(core, T0, 10);
    await appendLog(notes, "desktop", { card: card!.id, at: formatAt(T0), rating: 1 });

    const after = await dueCards(core, T0, 10);
    expect(after.map((c) => c.id)).not.toContain(card!.id);
  });

  it("is a no-op when nothing new has arrived", async () => {
    await dueCards(core, T0, 10);
    const second = await dueCards(core, T0, 10);
    expect(second).toHaveLength(2);
  });
});

describe("reading the counts", () => {
  it("counts a card answered elsewhere as reviewed, not as new", async () => {
    expect((await counts(core, T0, 100)).newCards).toBe(2);

    const [card] = await dueCards(core, T0, 10);
    await answeredElsewhere(card!.id, T0);

    const after = await counts(core, T0, 100);
    expect(after.newCards).toBe(1);
    expect(after.total).toBe(2);
  });
});

describe("concurrent reads", () => {
  it("shares one ingest between dueCards and counts requested together", async () => {
    // App.tsx requests both with Promise.all on every load. Each opens its own
    // cursor before the other's transaction commits unless the ingest itself
    // is shared, which would parse the same unread log bytes twice.
    const [card] = await dueCards(core, T0, 10);
    await answeredElsewhere(card!.id, T0);

    const ingestLogs = vi.spyOn(core, "ingestLogs");

    const [due, counted] = await Promise.all([dueCards(core, T0, 10), counts(core, T0, 100)]);

    expect(ingestLogs).toHaveBeenCalledTimes(1);
    expect(due).toHaveLength(1);
    expect(counted.newCards).toBe(1);
  });
});

describe("a busy database", () => {
  it("is not allowed to cost the user their session", async () => {
    // A long sync or rebuild holds the single write lock, so an ingest issued
    // during one throws. The reviews are in the log either way and the next read
    // will collect them — losing the queue over it would be the worse trade.
    const busy = new Error("database is locked") as Error & { code: string };
    busy.code = "SQLITE_BUSY";
    const wedged = {
      ingestLogs: () => Promise.reject(busy),
      getDueCards: () => [{ id: "sr-000000000001" }],
      stats: () => ({ total: 1, dueNow: 0, dueBeforeMidnight: 0, newCards: 1, capped: false }),
    } as unknown as Core;

    await expect(dueCards(wedged, T0, 10)).resolves.toHaveLength(1);
    await expect(counts(wedged, T0, 100)).resolves.toMatchObject({ total: 1 });
  });

  it("still reports a failure that is not a busy database", async () => {
    const broken = {
      ingestLogs: () => Promise.reject(new Error("disk is on fire")),
    } as unknown as Core;
    await expect(dueCards(broken, T0, 10)).rejects.toThrow("disk is on fire");
  });
});
