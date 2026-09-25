import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  configPath,
  defaultDbPath,
  legacyConfigPath,
  settleConfigPath,
  defaultDevice,
  ensureConfig,
  initConfig,
  InitRefused,
  newId,
  readConfig,
  readSettings,
  setEditor,
  addVault,
  chooseVault,
  renameVault,
  removeVault,
  removeDatabase,
  VaultRefused,
  vaultDbPath,
} from "./config.js";
import { classify, isBusy } from "./errors.js";
import { ConfigError } from "../core/index.js";
import { ID_PATTERN } from "../parser/index.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "geode-host-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("where the config lives", () => {
  const none = {} as NodeJS.ProcessEnv;

  it("uses the geodemd directory, while the command stays `geode`", () => {
    // The project is GeodeMD; the binary is deliberately the shorter `geode`.
    // These are two separate decisions and each is easy to change by accident.
    const env = { XDG_CONFIG_HOME: "/x/cfg", XDG_DATA_HOME: "/x/data" } as NodeJS.ProcessEnv;
    expect(configPath(env, "linux")).toBe(path.join("/x/cfg", "geodemd", "config.json"));
    expect(defaultDbPath(env)).toBe(path.join("/x/data", "geodemd", "db.sqlite"));
  });

  it("is Application Support on macOS (ADR 0026)", () => {
    expect(configPath(none, "darwin", "/Users/me")).toBe(
      path.join("/Users/me", "Library", "Application Support", "GeodeMD", "config.json"),
    );
  });

  it("is ~/.config elsewhere", () => {
    expect(configPath(none, "linux", "/home/me")).toBe(
      path.join("/home/me", ".config", "geodemd", "config.json"),
    );
  });

  it("honours an explicit XDG_CONFIG_HOME on macOS too", () => {
    // How the self-test and every demo keep off the config pointing at real
    // notes. Losing this would make them quietly repoint a live collection.
    const env = { XDG_CONFIG_HOME: "/x/cfg" } as NodeJS.ProcessEnv;
    expect(configPath(env, "darwin", "/Users/me")).toBe(path.join("/x/cfg", "geodemd", "config.json"));
    expect(legacyConfigPath(env, "darwin", "/Users/me")).toBeNull();
  });

  it("leaves the database default where it was", () => {
    expect(defaultDbPath(none)).toBe(path.join(os.homedir(), ".local", "share", "geodemd", "db.sqlite"));
  });
});

describe("moving an old Mac config into Application Support", () => {
  const none = {} as NodeJS.ProcessEnv;
  const oldFile = () => path.join(dir, ".config", "geodemd", "config.json");
  const newFile = () => configPath(none, "darwin", dir);
  const put = async (file: string, body: string) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  };

  it("moves it, so an existing install does not open to first-run setup", async () => {
    // Setup would mint a new device and split this machine's history in two.
    await put(oldFile(), '{"notesPath":"/n","device":"mac-ab12"}\n');
    expect(await settleConfigPath(none, "darwin", dir)).toBe(newFile());
    expect((await readConfig(newFile()))?.device).toBe("mac-ab12");
    await expect(fs.access(oldFile())).rejects.toThrow();
    // The emptied directory goes too; ~/.config itself is not ours to remove.
    await expect(fs.access(path.dirname(oldFile()))).rejects.toThrow();
    await fs.access(path.join(dir, ".config"));
  });

  it("never overwrites a config already at the new path", async () => {
    await put(oldFile(), '{"notesPath":"/old"}');
    await put(newFile(), '{"notesPath":"/new"}');
    expect(await settleConfigPath(none, "darwin", dir)).toBe(newFile());
    expect((await readConfig(newFile()))?.notesPath).toBe("/new");
    expect((await readConfig(oldFile()))?.notesPath).toBe("/old");
  });

  it("keeps using the old file when the move fails", async () => {
    // Answering with an empty new path would show first-run setup while a
    // config exists — the thing the move is for.
    await put(oldFile(), '{"notesPath":"/n"}');
    await fs.mkdir(path.join(dir, "Library"), { recursive: true });
    await fs.chmod(path.join(dir, "Library"), 0o500);
    try {
      expect(await settleConfigPath(none, "darwin", dir)).toBe(oldFile());
      expect((await readConfig(oldFile()))?.notesPath).toBe("/n");
    } finally {
      await fs.chmod(path.join(dir, "Library"), 0o700);
    }
  });

  it("does nothing on a first run, off macOS, or under XDG_CONFIG_HOME", async () => {
    expect(await settleConfigPath(none, "darwin", dir)).toBe(newFile());
    await put(oldFile(), '{"notesPath":"/n"}');
    expect(await settleConfigPath(none, "linux", dir)).toBe(oldFile());
    const xdg = { XDG_CONFIG_HOME: path.join(dir, "x") } as NodeJS.ProcessEnv;
    expect(await settleConfigPath(xdg, "darwin", dir)).toBe(configPath(xdg, "darwin", dir));
    await fs.access(oldFile());
  });
});

describe("minting a card id", () => {
  it("mints the shape section 4 specifies", () => {
    for (let i = 0; i < 100; i++) expect(newId()).toMatch(ID_PATTERN);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 1000 }, newId));
    expect(seen.size).toBe(1000);
  });
});

describe("naming this device", () => {
  it("slugifies the hostname and appends a suffix", () => {
    const d = defaultDevice("MacBook-Pro.local");
    expect(d).toMatch(/^macbook-pro-[a-z0-9]{4}$/);
  });

  it("gives two identically-named machines different names", () => {
    // Section 5a: they would otherwise share a filename and break the
    // one-writer-per-file invariant the log layout rests on.
    expect(defaultDevice("macbook-pro")).not.toBe(defaultDevice("macbook-pro"));
  });

  it("copes with a hostname that slugifies to nothing", () => {
    expect(defaultDevice("...")).toMatch(/^device-[a-z0-9]{4}$/);
  });
});

describe("writing a config for the first time", () => {
  it("writes the three keys", async () => {
    const file = path.join(dir, "config.json");
    const c = await initConfig(file, dir);
    expect(c.notesPath).toBe(path.resolve(dir));
    expect(await readConfig(file)).toEqual(c);
  });

  it("refuses to overwrite an existing config", async () => {
    const file = path.join(dir, "config.json");
    await initConfig(file, dir);
    await expect(initConfig(file, dir)).rejects.toBeInstanceOf(InitRefused);
  });

  it("preserves device under --force", async () => {
    const file = path.join(dir, "config.json");
    const first = await initConfig(file, dir);
    const second = await initConfig(file, path.join(dir, "elsewhere"), { force: true });

    // Re-runnable to fix a notesPath typo, without that doubling as a way to
    // change the machine's identity and scatter its history across two shards.
    expect(second.device).toBe(first.device);
    expect(second.notesPath).not.toBe(first.notesPath);
  });

  it("reads an editor when one is set, and nothing when it is not", async () => {
    const file = path.join(dir, "config.json");
    await initConfig(file, dir);
    expect((await readConfig(file))!.editor).toBeUndefined();

    await fs.writeFile(
      file,
      JSON.stringify({ notesPath: dir, device: "d", dbPath: "db", editor: "nvim" }),
      "utf8",
    );
    expect((await readConfig(file))!.editor).toBe("nvim");
  });

  it("preserves editor under --force, like device", async () => {
    // Re-running init to fix a notesPath typo should not silently discard a
    // setting it never asked about.
    const file = path.join(dir, "config.json");
    await initConfig(file, dir);
    const withEditor = { ...(await readConfig(file))!, editor: "nvim" };
    await fs.writeFile(file, JSON.stringify(withEditor), "utf8");

    const second = await initConfig(file, path.join(dir, "elsewhere"), { force: true });
    expect(second.editor).toBe("nvim");
  });

  it("returns null for a missing or malformed config", async () => {
    expect(await readConfig(path.join(dir, "nope.json"))).toBeNull();
    const bad = path.join(dir, "bad.json");
    await fs.writeFile(bad, "{ not json", "utf8");
    expect(await readConfig(bad)).toBeNull();
  });
});

describe("choosing an editor from the app", () => {
  it("sets the editor and keeps every other key", async () => {
    const file = path.join(dir, "config.json");
    const first = await initConfig(file, dir);
    await setEditor(file, "code");
    const after = await readConfig(file);
    expect(after).toEqual({ ...first, editor: "code" });
  });

  it("removes the key for the system default", async () => {
    const file = path.join(dir, "config.json");
    await initConfig(file, dir);
    await setEditor(file, "code");
    await setEditor(file, null);
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    expect("editor" in raw).toBe(false);
  });

  it("treats a blank value as the system default", async () => {
    const file = path.join(dir, "config.json");
    await initConfig(file, dir);
    await setEditor(file, "   ");
    expect((await readConfig(file))!.editor).toBeUndefined();
  });

  it("persists a device rather than minting a new one on every write", async () => {
    const file = path.join(dir, "config.json");
    await fs.writeFile(file, JSON.stringify({ notesPath: dir, dbPath: "db" }), "utf8");
    const set = await setEditor(file, "code");
    expect((await readConfig(file))!.device).toBe(set!.device);
  });

  it("is null when there is no config to set it in", async () => {
    expect(await setEditor(path.join(dir, "nope.json"), "code")).toBeNull();
  });
});

describe("reading a config, and healing a missing device", () => {
  /** A config written by hand, or by an older version, with no device. */
  async function withoutDevice(): Promise<string> {
    const file = path.join(dir, "config.json");
    await fs.writeFile(file, JSON.stringify({ notesPath: dir }), "utf8");
    return file;
  }

  it("readConfig alone hands out a different device every time", async () => {
    // The bug ensureConfig exists to fix, pinned so it cannot come back
    // disguised as a refactor.
    const file = await withoutDevice();
    const a = await readConfig(file);
    const b = await readConfig(file);
    expect(a!.device).not.toBe(b!.device);
  });

  it("mints a device once and persists it", async () => {
    const file = await withoutDevice();
    const first = await ensureConfig(file);
    const second = await ensureConfig(file);
    expect(second!.device).toBe(first!.device);

    // On disk, not just in the return value — the next process must agree.
    const onDisk = JSON.parse(await fs.readFile(file, "utf8")) as { device?: string };
    expect(onDisk.device).toBe(first!.device);
  });

  it("leaves an existing device alone and writes nothing", async () => {
    const file = path.join(dir, "config.json");
    const vault = { id: "abcd1234", name: "notes", notesPath: dir, dbPath: "db" };
    await fs.writeFile(
      file,
      JSON.stringify({ device: "fixed-abcd", active: vault.id, vaults: [vault] }),
      "utf8",
    );
    const before = await fs.stat(file);
    expect((await ensureConfig(file))!.device).toBe("fixed-abcd");
    expect((await fs.stat(file)).mtimeMs).toBe(before.mtimeMs);
  });

  it("leaves exactly one device behind when two heals race, and settles after", async () => {
    // Both mint a name and both write. The guarantee is about the FILE: it ends
    // up with one device and every later read agrees. A loser may still use the
    // name it minted for its own session — see ensureConfig's comment for why
    // closing that is not worth an election.
    const file = await withoutDevice();
    const [a, b] = await Promise.all([ensureConfig(file), ensureConfig(file)]);
    expect(a!.device).toBeTruthy();
    expect(b!.device).toBeTruthy();

    const onDisk = JSON.parse(await fs.readFile(file, "utf8")) as { device?: string };
    expect(onDisk.device).toBeTruthy();
    // One of them won, and no third name was invented.
    expect([a!.device, b!.device]).toContain(onDisk.device);

    // Settled: every subsequent reader agrees, which is what the log layout
    // actually needs.
    expect((await ensureConfig(file))!.device).toBe(onDisk.device);
    expect((await ensureConfig(file))!.device).toBe(onDisk.device);
  });

  it("does not leave temp files behind", async () => {
    const file = await withoutDevice();
    await Promise.all([ensureConfig(file), ensureConfig(file)]);
    const strays = (await fs.readdir(dir)).filter((n) => n.endsWith(".tmp"));
    expect(strays).toEqual([]);
  });

  it("is null for a missing config, like readConfig", async () => {
    expect(await ensureConfig(path.join(dir, "nope.json"))).toBeNull();
  });
});

describe("migrating a single-folder config into a vault", () => {
  /** What every install before vaults has on disk. */
  async function legacy(fields: Record<string, unknown>): Promise<string> {
    const file = path.join(dir, "config.json");
    await fs.writeFile(file, JSON.stringify(fields), "utf8");
    return file;
  }
  const env = (): NodeJS.ProcessEnv => ({ XDG_DATA_HOME: path.join(dir, "data") });

  it("keeps device, dbPath and editor, so this machine's history stays in one shard", async () => {
    const notes = path.join(dir, "notes");
    const file = await legacy({ notesPath: notes, device: "mac-ab12", dbPath: "/db/here.sqlite", editor: "code" });
    const c = await ensureConfig(file, env());
    expect(c).toMatchObject({ notesPath: notes, device: "mac-ab12", dbPath: "/db/here.sqlite", editor: "code" });
  });

  it("reads back as one vault, named after its folder and active", async () => {
    const file = await legacy({ notesPath: path.join(dir, "notes"), device: "mac-ab12", dbPath: "/db" });
    await ensureConfig(file, env());
    const s = (await readSettings(file, env()))!;
    expect(s.vaults).toHaveLength(1);
    expect(s.vaults[0]).toMatchObject({ name: "notes", notesPath: path.join(dir, "notes"), dbPath: "/db" });
    expect(s.active).toBe(s.vaults[0]!.id);

    // On disk in the new shape, with the old top-level keys gone.
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    expect(raw["notesPath"]).toBeUndefined();
    expect(raw["device"]).toBe("mac-ab12");
  });

  it("keeps the database where the old default put it, rather than moving it under vaults/", async () => {
    // The existing database becomes the first vault's; a path under vaults/
    // would open an empty one and re-read every note.
    const file = await legacy({ notesPath: dir, device: "mac-ab12" });
    expect((await ensureConfig(file, env()))!.dbPath).toBe(path.join(dir, "data", "geodemd", "db.sqlite"));
  });

  it("migrates once: the vault id is persisted, and the next read writes nothing", async () => {
    const file = await legacy({ notesPath: dir, device: "mac-ab12" });
    const first = await ensureConfig(file, env());
    const before = await fs.stat(file);
    const second = await ensureConfig(file, env());
    expect(second!.id).toBe(first!.id);
    expect((await fs.stat(file)).mtimeMs).toBe(before.mtimeMs);
  });

  it("leaves the old config readable when the migration cannot be written", async () => {
    const sub = path.join(dir, "locked");
    await fs.mkdir(sub);
    const file = path.join(sub, "config.json");
    const body = JSON.stringify({ notesPath: dir, device: "mac-ab12", dbPath: "/db" });
    await fs.writeFile(file, body, "utf8");
    await fs.chmod(sub, 0o500);
    try {
      // The app still opens, on the same device and database…
      expect(await ensureConfig(file, env())).toMatchObject({ device: "mac-ab12", dbPath: "/db" });
      // …and the file is exactly what it was, to be migrated next time.
      expect(await fs.readFile(file, "utf8")).toBe(body);
      expect((await fs.readdir(sub)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    } finally {
      await fs.chmod(sub, 0o700);
    }
  });
});

describe("keeping a list of vaults", () => {
  const env = (): NodeJS.ProcessEnv => ({ XDG_DATA_HOME: path.join(dir, "data") });
  const file = (): string => path.join(dir, "config.json");

  async function twoVaults(): Promise<{ first: string; second: string }> {
    await fs.mkdir(path.join(dir, "home"), { recursive: true });
    await fs.mkdir(path.join(dir, "work"), { recursive: true });
    const first = (await initConfig(file(), path.join(dir, "home"), { env: env() })).id;
    const second = (await addVault(file(), path.join(dir, "work"), { env: env() })).id;
    return { first, second };
  }

  it("gives an added vault its own database, and makes it the open one", async () => {
    const before = await initConfig(file(), path.join(dir, "home"), { env: env() });
    const added = await addVault(file(), path.join(dir, "work"), { env: env() });
    expect(added.dbPath).toBe(vaultDbPath(added.id, env()));
    expect(added.dbPath).not.toBe(before.dbPath);
    expect(added.name).toBe("work");
    expect((await readConfig(file(), env()))!.id).toBe(added.id);
  });

  it("shares device and editor across vaults, since both are about the machine", async () => {
    const before = await initConfig(file(), path.join(dir, "home"), { env: env() });
    await setEditor(file(), "code", env());
    const added = await addVault(file(), path.join(dir, "work"), { env: env() });
    expect(added.device).toBe(before.device);
    expect(added.editor).toBe("code");
  });

  it("uses the id the proposal showed, and replaces one that is malformed or taken", async () => {
    const first = await initConfig(file(), path.join(dir, "home"), { env: env() });
    expect((await addVault(file(), path.join(dir, "a"), { id: "abcd1234", env: env() })).id).toBe("abcd1234");
    expect((await addVault(file(), path.join(dir, "b"), { id: "abcd1234", env: env() })).id).not.toBe("abcd1234");
    expect((await addVault(file(), path.join(dir, "c"), { id: "../../x", env: env() })).id).toMatch(/^[a-z0-9]{8}$/);
    expect((await addVault(file(), path.join(dir, "d"), { id: first.id, env: env() })).id).not.toBe(first.id);
  });

  it("names two vaults apart even when their folders share a name", async () => {
    await initConfig(file(), path.join(dir, "a", "notes"), { env: env() });
    expect((await addVault(file(), path.join(dir, "b", "notes"), { env: env() })).name).toBe("notes 2");
  });

  it("refuses to add a vault that overlaps one already in the list", async () => {
    await initConfig(file(), path.join(dir, "home"), { env: env() });
    await expect(addVault(file(), path.join(dir, "home", "sub"), { env: env() })).rejects.toBeInstanceOf(VaultRefused);
    await expect(addVault(file(), dir, { env: env() })).rejects.toBeInstanceOf(VaultRefused);
    expect((await readSettings(file(), env()))!.vaults).toHaveLength(1);
  });

  it("switches by changing only which vault is active", async () => {
    const { first } = await twoVaults();
    const before = (await readSettings(file(), env()))!;
    await chooseVault(file(), first, env());
    const after = (await readSettings(file(), env()))!;
    expect(after.active).toBe(first);
    expect(after.vaults).toEqual(before.vaults);
    expect(after.device).toBe(before.device);
    await expect(chooseVault(file(), "nosuchid", env())).rejects.toBeInstanceOf(VaultRefused);
  });

  it("renames a vault without moving anything, and refuses a blank or taken name", async () => {
    const { first, second } = await twoVaults();
    const s = await renameVault(file(), first, "  Personal ", env());
    expect(s.vaults.find((v) => v.id === first)).toMatchObject({ name: "Personal", notesPath: path.join(dir, "home") });
    await expect(renameVault(file(), first, "  ", env())).rejects.toBeInstanceOf(VaultRefused);
    await expect(renameVault(file(), second, "Personal", env())).rejects.toBeInstanceOf(VaultRefused);
  });

  it("will not remove the open vault", async () => {
    const { second } = await twoVaults();
    await expect(removeVault(file(), second, env())).rejects.toBeInstanceOf(VaultRefused);
  });

  it("removes a vault without touching its notes or its log", async () => {
    const { first } = await twoVaults();
    await fs.mkdir(path.join(dir, "home", ".sr", "log"), { recursive: true });
    await fs.writeFile(path.join(dir, "home", "a.md"), "Q :: A\n");
    await fs.writeFile(path.join(dir, "home", ".sr", "log", "mac-2026-09.jsonl"), "{}\n");

    const { removed, settings } = await removeVault(file(), first, env());
    expect(removed.id).toBe(first);
    expect(settings.vaults.map((v) => v.id)).not.toContain(first);
    expect(await fs.readFile(path.join(dir, "home", "a.md"), "utf8")).toBe("Q :: A\n");
    await fs.access(path.join(dir, "home", ".sr", "log", "mac-2026-09.jsonl"));
  });

  it("deletes a removed vault's database only when asked, and its directory with it", async () => {
    const { first, second } = await twoVaults();
    const work = (await readSettings(file(), env()))!.vaults.find((v) => v.id === second)!;
    await fs.mkdir(path.dirname(work.dbPath), { recursive: true });
    for (const f of ["", "-wal", "-shm"]) await fs.writeFile(`${work.dbPath}${f}`, "x");

    await chooseVault(file(), first, env());
    const { removed } = await removeVault(file(), second, env());
    await fs.access(work.dbPath); // removing from the list alone keeps it
    await removeDatabase(removed);
    await expect(fs.access(path.dirname(work.dbPath))).rejects.toThrow();
  });

  it("re-points the open vault, keeping its id and its database", async () => {
    const { second } = await twoVaults();
    const before = (await readConfig(file(), env()))!;
    const after = await initConfig(file(), path.join(dir, "moved"), { force: true, env: env() });
    expect(after).toMatchObject({ id: second, dbPath: before.dbPath, device: before.device });
    // The name followed the folder, because it was still the folder's name.
    expect(after.name).toBe("moved");
    expect((await readSettings(file(), env()))!.vaults).toHaveLength(2);
  });

  it("keeps a name the user chose when the vault is re-pointed", async () => {
    const { second } = await twoVaults();
    await renameVault(file(), second, "Job", env());
    expect((await initConfig(file(), path.join(dir, "moved"), { force: true, env: env() })).name).toBe("Job");
  });

  it("refuses to re-point a vault into another one", async () => {
    await twoVaults();
    await expect(
      initConfig(file(), path.join(dir, "home", "inside"), { force: true, env: env() }),
    ).rejects.toBeInstanceOf(VaultRefused);
  });
});

describe("classifying an error", () => {
  it("classifies while the error still has its prototype", () => {
    // The whole reason this module exists: across IPC the class is gone, so
    // the tag has to be attached on the near side.
    expect(classify(new ConfigError("nope"))).toBe("config");
    expect(classify(new InitRefused("nope"))).toBe("init-refused");
    expect(classify(new Error("nope"))).toBe("internal");
  });
});

/**
 * `isBusy` is duck-typed on `.code`, and that is not incidental:
 * better-sqlite3 throws its own error class, and the *class* is what gets
 * stripped crossing Electron's IPC while the property survives.
 */
describe("recognising a busy database", () => {
  it("recognises both busy codes SQLite produces", () => {
    // SQLITE_BUSY_SNAPSHOT is the WAL-specific one and is just as much "try
    // again later" — matching only the bare code would miss it.
    expect(isBusy({ code: "SQLITE_BUSY" })).toBe(true);
    expect(isBusy({ code: "SQLITE_BUSY_SNAPSHOT" })).toBe(true);
    expect(isBusy({ code: "SQLITE_BUSY_TIMEOUT" })).toBe(true);
  });

  it("does not treat other SQLite failures as retryable", () => {
    // A constraint violation is a bug; reporting it as "the database was busy
    // and will catch up" would swallow it silently.
    expect(isBusy({ code: "SQLITE_CONSTRAINT" })).toBe(false);
    expect(isBusy({ code: "SQLITE_CORRUPT" })).toBe(false);
    expect(isBusy({ code: "SQLITE_READONLY" })).toBe(false);
  });

  it("survives anything at all being thrown", () => {
    for (const thrown of [null, undefined, "SQLITE_BUSY", 42, new Error("SQLITE_BUSY"), {}]) {
      expect(isBusy(thrown), String(thrown)).toBe(false);
    }
  });

  it("reads the property rather than the class, which does not survive IPC", () => {
    // An error whose prototype has been stripped by serialization still has
    // `.code`, and that is the whole reason this is duck-typed.
    const plain = JSON.parse(JSON.stringify({ code: "SQLITE_BUSY", message: "locked" })) as unknown;
    expect(plain).not.toBeInstanceOf(Error);
    expect(isBusy(plain)).toBe(true);
  });
});
