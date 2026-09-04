import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Core } from "./index.js";
import { Store } from "../store/index.js";

/**
 * Spec section 10: the scale harness — asserting SHAPE, not seconds.
 *
 * Wall-clock ceilings are machine-dependent: they pass on a laptop and fail in
 * CI, and then someone raises the ceiling until it means nothing. These assert
 * ratios and counts instead, and are sized to run in the default suite, because
 * a suite people stop running guards nothing.
 */

const MTIME = new Date("2026-09-01T00:00:00.000Z");
const T0 = new Date("2026-09-02T12:00:00.000Z");

let roots: string[] = [];

beforeEach(() => {
  roots = [];
});
afterEach(async () => {
  for (const r of roots) await fs.rm(r, { recursive: true, force: true });
});

interface Harness {
  notes: string;
  store: Store;
  core: Core;
}

/** A synthetic tree of `fileCount` notes holding `cardsPer` cards each. */
async function makeTree(fileCount: number, cardsPer: number): Promise<Harness> {
  const notes = await fs.mkdtemp(path.join(os.tmpdir(), "geode-scale-"));
  roots.push(notes);

  const perDir = 100;
  for (let d = 0; d * perDir < fileCount; d++) {
    const dir = path.join(notes, `d${d}`);
    await fs.mkdir(dir, { recursive: true });
    for (let f = 0; f < perDir && d * perDir + f < fileCount; f++) {
      const n = d * perDir + f;
      let body = "";
      for (let c = 0; c < cardsPer; c++) body += `Q${n}_${c} :: A${n}_${c}\n`;
      const abs = path.join(dir, `n${f}.md`);
      await fs.writeFile(abs, body, "utf8");
      await fs.utimes(abs, MTIME, MTIME);
    }
  }

  const store = new Store(":memory:");
  let i = 0;
  const core = new Core(
    {
      notesPath: notes,
      device: "scale",
      dbPath: ":memory:",
      newId: () => `sr-${String(++i).padStart(12, "0")}`,
    },
    store,
  );
  return { notes, store, core };
}

async function timeMs(fn: () => Promise<unknown>): Promise<number> {
  const t = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
}

describe("the invariant that is not a time at all", () => {
  it("a sync that finds nothing changed performs ZERO writes", async () => {
    const { store, core } = await makeTree(200, 5);
    await core.sync(T0);

    const before = store.totalChanges();
    const summary = await core.sync(new Date(T0.getTime() + 60_000));

    // This is what step 6's count check exists to provide, and the thing that
    // silently regresses the moment someone adds innocuous bookkeeping.
    expect(store.totalChanges()).toBe(before);
    expect(summary.filesUnchanged).toBe(200);
    expect(summary.filesRead).toBe(0);
    expect(summary.reconciled).toBe(false);
  });

  it("holds at a larger card count too — it is not a small-tree accident", async () => {
    const { store, core } = await makeTree(100, 50);
    await core.sync(T0);
    expect(store.countCards()).toBe(5000);

    const before = store.totalChanges();
    await core.sync(new Date(T0.getTime() + 60_000));
    expect(store.totalChanges()).toBe(before);
  });

  it("a single-file change reads exactly one file", async () => {
    const { notes, core } = await makeTree(200, 5);
    await core.sync(T0);

    const target = path.join(notes, "d0", "n7.md");
    const text = await fs.readFile(target, "utf8");
    await fs.writeFile(target, `${text}Extra :: card\n`, "utf8");
    await fs.utimes(target, MTIME, new Date(MTIME.getTime() + 5000));

    const s = await core.sync(new Date(T0.getTime() + 60_000));
    expect(s.filesRead).toBe(1);
    expect(s.filesUnchanged).toBe(199);
  });

  it("deleting a file is the only thing that triggers the reconciliation pass", async () => {
    const { notes, core } = await makeTree(100, 3);
    await core.sync(T0);

    expect((await core.sync(T0)).reconciled).toBe(false);

    const target = path.join(notes, "d0", "n5.md");
    const text = await fs.readFile(target, "utf8");
    await fs.writeFile(target, `${text}Extra :: card\n`, "utf8");
    await fs.utimes(target, MTIME, new Date(MTIME.getTime() + 5000));
    expect((await core.sync(T0)).reconciled).toBe(false);

    await fs.rm(target);
    expect((await core.sync(T0)).reconciled).toBe(true);
  });
});

describe("shape, not seconds", () => {
  it("a no-change sync scales with FILE count", async () => {
    const small = await makeTree(200, 5);
    const large = await makeTree(1000, 5);
    await small.core.sync(T0);
    await large.core.sync(T0);

    const t = (h: Harness) => timeMs(() => h.core.sync(new Date(T0.getTime() + 60_000)));
    await t(small); // warm both paths before measuring
    await t(large);

    const ts = Math.max(await t(small), 0.5);
    const tl = await t(large);

    // 5x the files. Generous bounds — the claim is "linear in files", not a
    // precise constant, and CI machines are noisy.
    expect(tl / ts).toBeGreaterThan(1.5);
    expect(tl / ts).toBeLessThan(20);
  });

  it("a no-change sync is FLAT in cards per file", async () => {
    // The assertion that matters: it fails the moment a per-card cost re-enters
    // a path that is supposed to be one stat and one indexed read per file.
    const few = await makeTree(300, 2);
    const many = await makeTree(300, 40);
    await few.core.sync(T0);
    await many.core.sync(T0);
    expect(many.store.countCards()).toBe(20 * few.store.countCards());

    const t = (h: Harness) => timeMs(() => h.core.sync(new Date(T0.getTime() + 60_000)));
    await t(few);
    await t(many);

    const tf = Math.max(await t(few), 0.5);
    const tm = await t(many);

    // 20x the cards, same file count: the time must not follow the cards.
    expect(tm / tf).toBeLessThan(4);
  });

  it("getDueCards is flat as the collection grows", async () => {
    const small = await makeTree(50, 5);
    const large = await makeTree(50, 100);
    await small.core.sync(T0);
    await large.core.sync(T0);
    expect(large.store.countCards()).toBe(5000);

    const t = (h: Harness) => timeMs(async () => h.core.getDueCards(T0, 50));
    await t(small);
    await t(large);

    const ts = Math.max(await t(small), 0.05);
    const tl = await t(large);
    expect(tl / ts).toBeLessThan(10);
    expect(large.core.getDueCards(T0, 50)).toHaveLength(50);
  });
});
