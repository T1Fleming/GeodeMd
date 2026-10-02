/**
 * Unlinking and erasing a vault (ADR 0035), against a real config, real notes
 * and real databases. `Active.change` is a stand-in that records whether it
 * was asked, or refuses as it does while a run is in flight.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { addVault, initConfig, readConfig, readSettings, VaultRefused } from "../../host/config.js";
import { openCore } from "../../host/open.js";
import { erase, erasePreview, unlink } from "./removal.js";
import type { RemovalDeps } from "./removal.js";

const T0 = new Date("2026-09-02T12:00:00.000Z");
const MTIME = new Date("2026-09-01T00:00:00.000Z");

let dir: string;
let home: string;
let work: string;
let ids: { home: string; work: string };
const file = () => path.join(dir, "config.json");
const env = () => ({ XDG_DATA_HOME: path.join(dir, "data") }) as NodeJS.ProcessEnv;

/** Asked to close the open vault; `refuse` plays a run in flight. */
function deps(refuse = false): RemovalDeps & { asked: number } {
  const d = {
    configFile: file(),
    asked: 0,
    active: {
      change: async <T>(write: () => Promise<T>) => {
        d.asked++;
        if (refuse) throw new VaultRefused("a sync is running in this vault");
        return { value: await write(), left: null };
      },
    },
  };
  return d as RemovalDeps & { asked: number };
}

async function note(root: string, rel: string, text: string): Promise<void> {
  await fs.writeFile(path.join(root, rel), text, "utf8");
  await fs.utimes(path.join(root, rel), MTIME, MTIME);
}

/** Sync a vault for real: stamps in its notes, a database, a log. */
async function synced(id: string): Promise<void> {
  const s = (await readSettings(file(), env()))!;
  const v = s.vaults.find((x) => x.id === id)!;
  const { core, store } = openCore({ ...v, device: s.device });
  await core.sync(T0);
  await core.reviewCard(core.getDueCards(T0, 1)[0]!.id, 3, T0);
  store.close();
}

const exists = (p: string) => fs.stat(p).then(() => true, () => false);
const read = (root: string, rel: string) => fs.readFile(path.join(root, rel), "utf8");

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "geode-removal-"));
  home = path.join(dir, "home");
  work = path.join(dir, "work");
  await fs.mkdir(home);
  await fs.mkdir(work);
  await note(home, "h.md", "Home Q >> A\n");
  await note(work, "w.md", "Work Q >> A\n");
  ids = {
    home: (await initConfig(file(), home, { env: env() })).id,
    work: (await addVault(file(), work, { env: env() })).id, // the open one
  };
  await synced(ids.home);
  await synced(ids.work);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const dbOf = async (id: string) => (await readSettings(file(), env()))!.vaults.find((v) => v.id === id)!.dbPath;

describe("removing a vault from the app", () => {
  it("leaves its notes and .sr/ alone, and deletes its database when asked", async () => {
    const db = await dbOf(ids.home);
    const d = deps();
    const s = await unlink(d, ids.home, true);
    expect(s!.vaults.map((v) => v.id)).toEqual([ids.work]);
    expect(d.asked).toBe(0); // not the open vault: nothing to close
    expect(await read(home, "h.md")).toContain("<!-- sr-");
    expect(await exists(path.join(home, ".sr", "log"))).toBe(true);
    expect(await exists(db)).toBe(false);
  });

  it("closes the open vault first, and opens the one left", async () => {
    const d = deps();
    const s = await unlink(d, ids.work, false);
    expect(d.asked).toBe(1);
    expect(s!.active).toBe(ids.home);
  });
});

describe("erasing GeodeMD from a vault", () => {
  it("previews what it would take out, writing nothing", async () => {
    const p = await erasePreview(deps(), ids.home);
    expect(p.stamps).toMatchObject({ files: 1, stamps: 1 });
    expect(p.sr).toMatchObject({ exists: true, logShards: 1 });
    expect(await read(home, "h.md")).toContain("<!-- sr-");
  });

  it("refuses without the vault's name typed, and changes nothing", async () => {
    await expect(erase(deps(), ids.home, "wrong")).rejects.toBeInstanceOf(VaultRefused);
    expect(await read(home, "h.md")).toContain("<!-- sr-");
    expect((await readSettings(file(), env()))!.vaults).toHaveLength(2);
  });

  it("takes out every stamp, deletes .sr/ and the database, and drops it from the list", async () => {
    const db = await dbOf(ids.work);
    const d = deps();
    const s = await erase(d, ids.work, "work");
    expect(d.asked).toBe(1);
    expect(await read(work, "w.md")).toBe("Work Q >> A\n");
    expect(await exists(path.join(work, ".sr"))).toBe(false);
    expect(await exists(db)).toBe(false);
    expect(s!.vaults.map((v) => v.id)).toEqual([ids.home]);
  });

  it("does nothing at all when the open vault cannot be closed", async () => {
    await expect(erase(deps(true), ids.work, "work")).rejects.toBeInstanceOf(VaultRefused);
    expect(await read(work, "w.md")).toContain("<!-- sr-");
    expect(await exists(path.join(work, ".sr"))).toBe(true);
    expect((await readSettings(file(), env()))!.vaults).toHaveLength(2);
  });

  it("leaves first-run setup behind when it was the last vault, keeping this machine's name", async () => {
    const device = (await readConfig(file(), env()))!.device;
    await erase(deps(), ids.home, "home");
    const last = await erase(deps(), ids.work, "work");
    expect(last).toBeNull();
    expect(await readConfig(file(), env())).toBeNull();
    const again = await initConfig(file(), home, { env: env() });
    expect(again.device).toBe(device);
  });
});
