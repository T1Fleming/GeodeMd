/**
 * Two machines over one notes directory.
 *
 * This is the premise [ADR 0014](../../docs/decisions/0014-cross-device-sync-transport.md)
 * rests on — that a second machine is *additive rather than a migration* —
 * and until this file nothing tested it. The properties were designed in and
 * argued for; they had never been run.
 *
 * The setup is what any file syncer or `git pull` produces: one shared notes
 * directory, and **two separate databases**, because the database is a local
 * cache that never travels ([ADR 0001](../../docs/decisions/0001-plain-text-is-the-durable-store.md)).
 * Nothing here is a transport. That is the point — if these hold, the choice
 * of transport is a user's decision rather than an architectural one.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Core } from "./index.js";
import { Store } from "../store/index.js";

let dir: string;
let notes: string;
let laptop: { core: Core; store: Store };
let desktop: { core: Core; store: Store };
let ids = 0;

const MTIME = new Date("2026-09-01T00:00:00.000Z");
const T0 = new Date("2026-09-02T12:00:00.000Z");
const LATER = new Date("2026-09-02T18:00:00.000Z");

/** A machine: its own database, its own device name, the same notes. */
function machine(device: string): { core: Core; store: Store } {
  const store = new Store(":memory:");
  const core = new Core(
    { notesPath: notes, device, dbPath: ":memory:", newId: () => `sr-${String(++ids).padStart(12, "0")}` },
    store,
  );
  return { core, store };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "geode-two-"));
  notes = path.join(dir, "notes");
  await fs.mkdir(notes, { recursive: true });
  ids = 0;
  laptop = machine("laptop-aaaa");
  desktop = machine("desktop-bbbb");
});

afterEach(async () => {
  laptop.store.close();
  desktop.store.close();
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(notes, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  await fs.utimes(abs, MTIME, MTIME);
}

/** Both machines read the shared notes. The laptop stamps; the desktop finds them stamped. */
async function bothSync(): Promise<string[]> {
  await write("a.md", "Q1 :: A1\nQ2 :: A2\n");
  await laptop.core.sync(T0);
  await desktop.core.sync(T0);
  return laptop.core.getDueCards(T0, 10).map((c) => c.id);
}

describe("two machines, one notes directory", () => {
  it("agree on card identity without ever talking to each other", async () => {
    // The stamp in the note IS the shared identity. Nothing is negotiated.
    const [id1, id2] = await bothSync();
    expect(desktop.store.getCard(id1!)).toBeDefined();
    expect(desktop.store.getCard(id2!)).toBeDefined();
    expect(desktop.core.stats(T0).total).toBe(2);
  });

  it("write to separate log shards, so a syncer never has to merge one file", async () => {
    const [id1, id2] = await bothSync();
    await laptop.core.reviewCard(id1!, 3, T0);
    await desktop.core.reviewCard(id2!, 3, T0);

    const shards = (await fs.readdir(path.join(notes, ".sr", "log"))).sort();
    expect(shards).toHaveLength(2);
    expect(shards[0]).toContain("desktop-bbbb");
    expect(shards[1]).toContain("laptop-aaaa");
  });

  it("each picks up the other's reviews on the next ingest", async () => {
    const [id1, id2] = await bothSync();
    await laptop.core.reviewCard(id1!, 3, T0);
    await desktop.core.reviewCard(id2!, 3, T0);

    // What arriving at the other machine looks like: the files are simply
    // there, and ingest reads every .jsonl it finds.
    await laptop.core.ingestLogs(LATER);
    await desktop.core.ingestLogs(LATER);

    for (const m of [laptop, desktop]) {
      expect(m.store.getState(id1!)?.reps, "card 1").toBe(1);
      expect(m.store.getState(id2!)?.reps, "card 2").toBe(1);
    }
  });

  it("converge on identical scheduling state, not merely on both having some", async () => {
    // The stronger claim, and the one that makes "additive" true: replaying
    // the same reviews through pinned FSRS parameters lands both machines on
    // the same due date, not just on a non-null one.
    const [id1] = await bothSync();
    await laptop.core.reviewCard(id1!, 4, T0);
    await desktop.core.ingestLogs(LATER);

    expect(desktop.store.getState(id1!)).toEqual(laptop.store.getState(id1!));
  });

  it("re-ingesting the same shards changes nothing", async () => {
    // `(card_id, rated_at)` is what lets a syncer re-deliver a file, or a
    // user re-run a sync, without inflating anyone's history.
    const [id1] = await bothSync();
    await laptop.core.reviewCard(id1!, 3, T0);

    await desktop.core.ingestLogs(LATER);
    const first = desktop.store.getState(id1!);
    const second = await desktop.core.ingestLogs(LATER);

    expect(second.reviewsIngested).toBe(0);
    expect(desktop.store.getState(id1!)).toEqual(first);
  });

  it("replays in the order things were RATED, not the order they arrived", async () => {
    // A syncer delivers whenever it delivers. If arrival order decided the
    // schedule, two machines would disagree permanently.
    const [id1] = await bothSync();
    await laptop.core.reviewCard(id1!, 1, T0);
    await laptop.core.reviewCard(id1!, 4, LATER);

    await desktop.core.ingestLogs(LATER);
    expect(desktop.store.getState(id1!)).toEqual(laptop.store.getState(id1!));
    expect(desktop.store.getState(id1!)!.reps).toBe(2);
  });

  it("survives a machine that has never seen the notes before", async () => {
    // The migration case: a third machine, empty database, arrives after all
    // the history exists. It should end up identical to the others.
    const [id1] = await bothSync();
    await laptop.core.reviewCard(id1!, 3, T0);

    const fresh = machine("newmachine-cccc");
    try {
      await fresh.core.sync(LATER);
      expect(fresh.store.getState(id1!)).toEqual(laptop.store.getState(id1!));
    } finally {
      fresh.store.close();
    }
  });

  it("does not need the database to travel", async () => {
    // The database is a cache. A machine that deletes it and rebuilds from
    // the shared notes and logs is indistinguishable from one that did not.
    const [id1] = await bothSync();
    await laptop.core.reviewCard(id1!, 2, T0);
    const before = laptop.store.getState(id1!);

    await laptop.core.rebuild(LATER);
    expect(laptop.store.getState(id1!)).toEqual(before);
  });
});

/**
 * The one ordering that costs something.
 *
 * Everything above assumes the notes were stamped once and then propagated.
 * If two machines each run a FIRST sync on the same unstamped notes before
 * they have exchanged anything, each mints its own ids for the same lines —
 * the stamp is the identity, and neither machine has anything to agree with.
 *
 * What it costs is worth being precise about, because the intuitive guess is
 * wrong. It does NOT duplicate cards: whichever copy of the note wins the
 * merge carries one set of ids, and the other set is pruned when it stops
 * appearing in any note. What is lost is the *history* recorded against the
 * losing ids — still in the log, still durable, but pointing at cards that no
 * longer exist.
 *
 * This is the operational rule a transport has to carry, and no transport
 * fixes it: stamp on one machine, let that propagate, then set up the second.
 */
describe("both machines stamping before they ever exchange", () => {
  it("converges on one set of ids rather than duplicating the cards", async () => {
    const other = path.join(dir, "other-machine");
    await fs.mkdir(other, { recursive: true });

    // Two machines, two copies of the same unstamped note, neither aware of
    // the other. Distinct id prefixes so the winner is identifiable.
    let n = 0;
    const store = new Store(":memory:");
    const solo = new Core(
      { notesPath: other, device: "solo-cccc", dbPath: ":memory:", newId: () => `sr-b${String(++n).padStart(11, "0")}` },
      store,
    );
    try {
      const write2 = async (root: string): Promise<void> => {
        const abs = path.join(root, "a.md");
        await fs.writeFile(abs, "Q1 :: A1\nQ2 :: A2\n", "utf8");
        await fs.utimes(abs, MTIME, MTIME);
      };
      await write2(notes);
      await write2(other);
      await laptop.core.sync(T0);
      await solo.sync(T0);

      const mine = laptop.core.getDueCards(T0, 10).map((c) => c.id);
      await laptop.core.reviewCard(mine[0]!, 3, T0);

      // The other machine's copy of the note arrives and wins the merge.
      await fs.copyFile(path.join(other, "a.md"), path.join(notes, "a.md"));
      await fs.utimes(path.join(notes, "a.md"), MTIME, MTIME);
      const s = await laptop.core.sync(LATER);

      // Not four cards. The losing ids are pruned when they stop appearing.
      expect(laptop.store.countCards()).toBe(2);
      expect(s.cardsNew).toBe(2);
      expect(s.cardsPruned).toBe(2);
      expect(s.duplicatesReminted).toBe(0);

      // And this is the cost: the review is stranded on an id no note holds.
      expect(laptop.store.getCard(mine[0]!)).toBeUndefined();
      expect(laptop.core.stats(LATER).newCards).toBe(2);
    } finally {
      store.close();
    }
  });
});
