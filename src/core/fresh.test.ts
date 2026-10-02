/**
 * Starting a vault fresh (ADR 0034): every card new again, the history moved
 * to `.sr/archive/`, ids and annotations untouched — and every device sharing
 * the folder following, because the decision is a file in the folder.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Core } from "./index.js";
import { Store } from "../store/index.js";
import { readAnnotation, writeAnnotation } from "../files/index.js";

let dir: string;
let notes: string;
let ids = 0;
const open: Store[] = [];

const MTIME = new Date("2026-09-01T00:00:00.000Z");
const T0 = new Date("2026-09-02T12:00:00.000Z");
const DAY2 = new Date("2026-09-03T12:00:00.000Z");
const DAY3 = new Date("2026-09-04T12:00:00.000Z");

function machine(device: string): { core: Core; store: Store } {
  const store = new Store(":memory:");
  open.push(store);
  const core = new Core(
    { notesPath: notes, device, dbPath: ":memory:", newId: () => `sr-${String(++ids).padStart(12, "0")}` },
    store,
  );
  return { core, store };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "geode-fresh-"));
  notes = path.join(dir, "notes");
  await fs.mkdir(notes, { recursive: true });
  ids = 0;
});

afterEach(async () => {
  for (const s of open.splice(0)) s.close();
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(notes, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  await fs.utimes(abs, MTIME, MTIME);
}

const read = (rel: string) => fs.readFile(path.join(notes, rel), "utf8");
const ls = async (rel: string) => {
  try {
    return (await fs.readdir(path.join(notes, rel))).sort();
  } catch {
    return [];
  }
};

/** A vault with two cards, both reviewed, one annotated. */
async function reviewed(device = "laptop-aaaa") {
  const m = machine(device);
  await write("a.md", "Q1 >> A1\nQ2 >> A2\n");
  await m.core.sync(T0);
  await m.core.reviewCard("sr-000000000001", 3, T0);
  await m.core.reviewCard("sr-000000000002", 1, T0);
  await writeAnnotation(notes, "sr-000000000001", "a mnemonic");
  return m;
}

describe("starting a vault fresh", () => {
  it("makes every card new, with no history and no schedule", async () => {
    const { core, store } = await reviewed();
    await core.startFresh(DAY2);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM reviews").get()).toEqual({ n: 0 });
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM card_state").get()).toEqual({ n: 0 });
    expect(core.getDueCards(DAY2, 10).map((c) => c.id)).toEqual(["sr-000000000001", "sr-000000000002"]);
    expect(core.stats(DAY2, 100)).toMatchObject({ total: 2, newCards: 2, dueNow: 0 });
  });

  it("edits no note and keeps every annotation", async () => {
    const { core } = await reviewed();
    const before = await read("a.md");
    await core.startFresh(DAY2);
    expect(await read("a.md")).toBe(before);
    expect(await readAnnotation(notes, "sr-000000000001")).toBe("a mnemonic");
  });

  it("moves the log whole into a dated archive, leaving the log empty", async () => {
    const { core } = await reviewed();
    const shards = await ls(".sr/log");
    expect(shards.length).toBeGreaterThan(0);
    await core.startFresh(DAY2);
    expect(await ls(".sr/log")).toEqual([]);
    expect(await ls(".sr/archive/2026-09-03T12-00-00.000Z/log")).toEqual(shards);
    expect(JSON.parse(await read(".sr/reset.json"))).toEqual({ at: "2026-09-03T12:00:00.000Z" });
  });

  it("records reviews made after it as usual", async () => {
    const { core } = await reviewed();
    await core.startFresh(DAY2);
    await core.reviewCard("sr-000000000001", 3, DAY3);
    expect(core.getDueCards(DAY3, 10).map((c) => c.id)).toEqual(["sr-000000000002"]);
    // And a rebuild from the notes and the new log agrees.
    await core.rebuild(DAY3);
    expect(core.getDueCards(DAY3, 10).map((c) => c.id)).toEqual(["sr-000000000002"]);
  });

  it("ignores a review from before it, even when its shard comes back", async () => {
    const { core, store } = await reviewed();
    await core.startFresh(DAY2);
    // A file syncer restores an archived shard into the log.
    const [shard] = await ls(".sr/archive/2026-09-03T12-00-00.000Z/log");
    await fs.copyFile(
      path.join(notes, ".sr/archive/2026-09-03T12-00-00.000Z/log", shard!),
      path.join(notes, ".sr/log", shard!),
    );
    await core.sync(DAY3);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM reviews").get()).toEqual({ n: 0 });
    expect(core.stats(DAY3, 100)).toMatchObject({ newCards: 2 });
  });

  it("is followed by another device sharing the folder, on its next sync", async () => {
    const laptop = await reviewed("laptop-aaaa");
    const desktop = machine("desktop-bbbb");
    await desktop.core.sync(T0);
    expect(desktop.core.stats(T0, 100)).toMatchObject({ newCards: 0 });

    await laptop.core.startFresh(DAY2);
    await desktop.core.sync(DAY2);
    expect(desktop.store.db.prepare("SELECT COUNT(*) AS n FROM reviews").get()).toEqual({ n: 0 });
    expect(desktop.core.stats(DAY2, 100)).toMatchObject({ newCards: 2 });
  });

  it("is finished by the next sync when it stopped after the marker", async () => {
    const { core, store } = await reviewed();
    // A crash right after the marker was written: log not archived, database
    // not derived again.
    await fs.writeFile(path.join(notes, ".sr/reset.json"), `${JSON.stringify({ at: DAY2.toISOString() })}\n`);
    await core.sync(DAY2);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM reviews").get()).toEqual({ n: 0 });
    expect(core.stats(DAY2, 100)).toMatchObject({ newCards: 2 });
  });

  it("is undone by moving the log back and removing the marker", async () => {
    const { core, store } = await reviewed();
    await core.startFresh(DAY2);
    const archived = path.join(notes, ".sr/archive/2026-09-03T12-00-00.000Z/log");
    for (const name of await fs.readdir(archived)) {
      await fs.rename(path.join(archived, name), path.join(notes, ".sr/log", name));
    }
    await fs.rm(path.join(notes, ".sr/reset.json"));
    await core.sync(DAY3);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM reviews").get()).toEqual({ n: 2 });
  });

  it("is left alone by a preview, which writes nothing", async () => {
    const { core, store } = await reviewed();
    await fs.writeFile(path.join(notes, ".sr/reset.json"), `${JSON.stringify({ at: DAY2.toISOString() })}\n`);
    await core.sync(DAY2, { dryRun: true });
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM reviews").get()).toEqual({ n: 2 });
  });

  it("does not report a change of card syntax", async () => {
    const { core } = await reviewed();
    await core.startFresh(DAY2);
    expect(core.syntaxChanged()).toBe(false);
  });

  it("refuses a marker that does not say when, rather than ignoring it", async () => {
    const { core } = await reviewed();
    await fs.writeFile(path.join(notes, ".sr/reset.json"), "{}");
    await expect(core.sync(DAY2)).rejects.toThrow(/reset\.json/);
  });
});
