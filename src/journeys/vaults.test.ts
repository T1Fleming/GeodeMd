/**
 * The journey `docs/guides/vaults.md` describes, held to what it says.
 *
 * The guide makes three kinds of claim worth holding it to: a table of what is
 * shared across vaults and what is not, a table of folders it says are
 * refused, and two promises about cost and loss — that coming back to an
 * unchanged vault reads nothing, and that removing a vault loses nothing.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  VaultRefused,
  addVault,
  chooseVault,
  defaultDbPath,
  initConfig,
  readConfig,
  removeVault,
  setEditor,
  vaultDbPath,
} from "../host/config.js";
import { openCore } from "../host/open.js";
import { fences, guide, paragraphWith, plain, tableAfter } from "./guide.js";

const T0 = new Date("2026-09-22T12:00:00.000Z");
const MTIME = new Date("2026-09-01T00:00:00.000Z");

let root: string;
let configFile: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "geode-journey-vaults-")));
  configFile = path.join(root, "config.json");
  env = { XDG_DATA_HOME: path.join(root, "data") } as NodeJS.ProcessEnv;
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const vaults = (): Promise<string> => guide("vaults.md");

async function note(dir: string, rel: string, body: string): Promise<void> {
  const abs = path.join(dir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body, "utf8");
  await fs.utimes(abs, MTIME, MTIME);
}

/** Open whatever vault the config says is active, sync it, close it. */
async function syncActive() {
  const c = (await readConfig(configFile, env))!;
  // Named for what it is to this journey — something to close, not to read.
  const { core, store: cache } = openCore(c);
  try {
    const summary = await core.sync(T0);
    return { summary, stats: core.stats(T0, 100) };
  } finally {
    cache.close();
  }
}

describe("what the guide says belongs to a vault, and what to the machine", () => {
  it("shares exactly the rows it says belong to the machine", async () => {
    const rows = tableAfter(await vaults(), "## What belongs to a vault");
    const scope = new Map(rows.map((r) => [plain(r[0]!), plain(r[1]!)]));
    expect(scope.get("device name")).toBe("the machine");
    expect(scope.get("editor")).toBe("the machine");
    for (const own of ["notes folder", "database", "name"]) expect(scope.get(own)).toBe("each vault");

    const first = await initConfig(configFile, path.join(root, "home"), { env });
    await setEditor(configFile, "code", env);
    const second = await addVault(configFile, path.join(root, "work"), { env });
    expect(second.device).toBe(first.device);
    expect(second.editor).toBe("code");
    expect(second.notesPath).not.toBe(first.notesPath);
    expect(second.dbPath).not.toBe(first.dbPath);
    // "It starts as the folder's name."
    expect([first.name, second.name]).toEqual(["home", "work"]);
  });
});

describe("where the guide says a new vault's database goes", () => {
  it("is the path it shows, and the first vault keeps the old one", async () => {
    const shown = fences(await vaults()).map((f) => f.trim()).find((f) => f.includes("vaults/<id>"));
    expect(shown, "the guide no longer shows the path").toBeDefined();
    const home = { XDG_DATA_HOME: "~/.local/share" } as NodeJS.ProcessEnv;
    expect(vaultDbPath("<id>", home).split(path.sep).join("/")).toBe(shown);

    expect(paragraphWith(await vaults(), "Your first vault keeps its database")).toBeTruthy();
    expect((await initConfig(configFile, path.join(root, "home"), { env })).dbPath).toBe(defaultDbPath(env));
  });
});

describe("what switching costs, as the guide promises it", () => {
  it("reads no notes on coming back to a vault whose notes have not changed", async () => {
    expect(await vaults()).toContain("a vault whose notes have not changed reads no notes at all");

    await note(path.join(root, "home"), "a.md", "H :: 1\n");
    await note(path.join(root, "work"), "b.md", "W :: 1\n");
    const home = await initConfig(configFile, path.join(root, "home"), { env });
    await syncActive();
    await addVault(configFile, path.join(root, "work"), { env });
    expect((await syncActive()).summary.filesRead).toBe(1);

    await chooseVault(configFile, home.id, env);
    const again = await syncActive();
    expect(again.summary.filesRead).toBe(0);
    expect(again.stats.total).toBe(1);
  });
});

describe("the folders the guide says are refused", () => {
  it("refuses and allows exactly the rows of its table", async () => {
    const rows = tableAfter(await vaults(), "## Vaults cannot overlap");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const at = (p: string): string => path.join(root, plain(p).replace(/^~\//, ""));

    for (const [i, [have, adding, verdict]] of rows.entries()) {
      // A config per row, so each row is judged against only its own vault.
      const file = path.join(root, `config-${i}.json`);
      await initConfig(file, at(have!), { env });
      const tried = addVault(file, at(adding!), { env });
      if (plain(verdict!).startsWith("refused")) {
        await expect(tried, `${have} then ${adding}`).rejects.toBeInstanceOf(VaultRefused);
      } else {
        await expect(tried, `${have} then ${adding}`).resolves.toBeTruthy();
      }
    }
  });
});

describe("what the guide says removing a vault keeps", () => {
  it("leaves its notes and log, so adding the folder again brings its history back", async () => {
    expect(await vaults()).toContain("adding that folder again later brings the vault back with its history");

    const homeDir = path.join(root, "home");
    await note(homeDir, "a.md", "H :: 1\n");
    const home = await initConfig(configFile, homeDir, { env });
    {
      const { core, store: cache } = openCore(home);
      try {
        await core.sync(T0);
        await core.reviewCard(core.getDueCards(T0, 1)[0]!.id, 3, T0);
      } finally {
        cache.close();
      }
    }
    const stamped = await fs.readFile(path.join(homeDir, "a.md"), "utf8");

    await addVault(configFile, path.join(root, "work"), { env });
    await removeVault(configFile, home.id, env);
    expect(await fs.readFile(path.join(homeDir, "a.md"), "utf8")).toBe(stamped);

    // Back again as a new vault, with a new, empty database of its own.
    const back = await addVault(configFile, homeDir, { env });
    expect(back.dbPath).not.toBe(home.dbPath);
    const { summary, stats } = await syncActive();
    expect(summary.reviewsIngested).toBe(1);
    expect(stats.newCards).toBe(0);
  });
});
