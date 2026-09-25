/**
 * Switching between two real vaults in temp directories — real config file,
 * real Stores on disk, no Electron and no mocks. `active.ts` imports nothing
 * from Electron for exactly this.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { VaultRefused, addVault, chooseVault, initConfig, readConfig } from "../../host/config.js";
import type { RunFinished } from "../ipc.js";
import { Active } from "./active.js";

const T0 = new Date("2026-09-02T12:00:00.000Z");
const MTIME = new Date("2026-09-01T00:00:00.000Z");

let root: string;
let configFile: string;
let active: Active;
let home: string;
let work: string;
let homeId: string;
let workId: string;
let finished: RunFinished[];
let onFinish: (() => void) | null;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "geode-active-"));
  configFile = path.join(root, "config", "config.json");
  home = path.join(root, "home");
  work = path.join(root, "work");
  await note(home, "a.md", "H1 :: one\nH2 :: two\n");
  await note(work, "b.md", "W1 :: one\n");

  const env = { XDG_DATA_HOME: path.join(root, "data") } as NodeJS.ProcessEnv;
  homeId = (await initConfig(configFile, home, { dbPath: path.join(root, "data", "home.sqlite"), env })).id;
  workId = (await addVault(configFile, work, { env })).id;

  finished = [];
  onFinish = null;
  active = new Active({
    configFile,
    emit: () => undefined,
    finish: (f) => {
      finished.push(f);
      onFinish?.();
    },
    now: () => T0,
  });
});
afterEach(async () => {
  active.reset();
  await fs.rm(root, { recursive: true, force: true });
});

/** A note, backdated out of the sync's two-second deferral window. */
async function note(dir: string, rel: string, body: string): Promise<void> {
  const abs = path.join(dir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body, "utf8");
  await fs.utimes(abs, MTIME, MTIME);
}

const switchTo = (id: string) => active.change(() => chooseVault(configFile, id));

describe("switching between vaults", () => {
  it("opens whichever vault the config names, lazily", async () => {
    expect(active.current).toBeNull();
    expect((await active.ensure()).config.id).toBe(workId);
  });

  it("reads no files on coming back to a vault, because its cache survived the switch", async () => {
    const first = await (await active.ensure()).core.sync(T0);
    expect(first.filesRead).toBe(1);

    await switchTo(homeId);
    expect((await (await active.ensure()).core.sync(T0)).filesRead).toBe(1);

    await switchTo(workId);
    const again = await (await active.ensure()).core.sync(T0);
    expect(again.filesRead).toBe(0);
    expect(again.cardsFound).toBe(0);
  });

  it("keeps each vault's cards and schedules its own", async () => {
    const w = await active.ensure();
    await w.core.sync(T0);
    expect(w.core.stats(T0, 100).total).toBe(1);

    await switchTo(homeId);
    const h = await active.ensure();
    await h.core.sync(T0);
    expect(h.core.stats(T0, 100).total).toBe(2);
    const card = h.core.getDueCards(T0, 10)[0]!;
    await h.core.reviewCard(card.id, 3, T0);

    // The review is in this vault's log and nowhere else.
    expect(await fs.readdir(path.join(home, ".sr", "log"))).toHaveLength(1);
    await expect(fs.readdir(path.join(work, ".sr", "log"))).rejects.toThrow();

    await switchTo(workId);
    const back = await active.ensure();
    expect(back.core.stats(T0, 100)).toMatchObject({ total: 1, newCards: 1 });
  });

  it("drops the old Store on a switch rather than keeping it open", async () => {
    const before = await active.ensure();
    await switchTo(homeId);
    expect(active.current).toBeNull();
    expect(() => before.core.stats(T0, 1)).toThrow();
  });
});

describe("switching while something is running", () => {
  it("is refused during a sync, and leaves the Store and the config alone", async () => {
    const open = await active.ensure();
    const done = new Promise<void>((r) => (onFinish = r));
    expect(open.runner.start("sync", { full: false, dryRun: false }).ok).toBe(true);

    await expect(switchTo(homeId)).rejects.toBeInstanceOf(VaultRefused);
    await expect(switchTo(homeId)).rejects.toThrow(/sync is running/);
    expect(active.current).toBe(open);
    expect((await readConfig(configFile))!.id).toBe(workId);

    // The run the switch waited out finishes against the Store it started on.
    await done;
    expect(finished[0]!.result.ok).toBe(true);
    await switchTo(homeId);
    expect((await active.ensure()).config.id).toBe(homeId);
  });

  it("refuses to open a vault while a switch is part-way through", async () => {
    // The config write is awaited, and another call can land during it. A run
    // started then would be running on the Store about to be closed.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await active.ensure();
    const switching = active.change(async () => {
      await gate;
      return chooseVault(configFile, homeId);
    });
    await expect(active.ensure()).rejects.toBeInstanceOf(VaultRefused);
    release();
    await switching;
    expect((await active.ensure()).config.id).toBe(homeId);
  });

  it("leaves the open vault open when the write itself is refused", async () => {
    const open = await active.ensure();
    await expect(active.change(() => chooseVault(configFile, "nosuchid"))).rejects.toBeInstanceOf(VaultRefused);
    expect(active.current).toBe(open);
  });
});

describe("the end of a session a switch interrupted", () => {
  it("answers which notes changed in the vault being left, before it is closed", async () => {
    const open = await active.ensure();
    await open.opened.opened("b.md");
    await fs.utimes(path.join(work, "b.md"), T0, T0);

    const { left } = await switchTo(homeId);
    expect(left).toEqual({ vault: workId, changed: ["b.md"] });
  });

  it("has nothing to answer when no vault was open", async () => {
    expect((await switchTo(homeId)).left).toBeNull();
  });
});

describe("a write composed in a vault that has since been left", () => {
  it("is refused rather than landing in the vault open now", async () => {
    const open = await active.ensureVault(workId);
    expect(open.config.id).toBe(workId);

    await switchTo(homeId);
    await expect(active.ensureVault(workId)).rejects.toBeInstanceOf(VaultRefused);
    expect((await active.ensureVault(homeId)).config.id).toBe(homeId);
  });
});
