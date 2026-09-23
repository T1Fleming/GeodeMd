import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  configPath,
  defaultDbPath,
  defaultDevice,
  ensureConfig,
  initConfig,
  InitRefused,
  newId,
  readConfig,
} from "./config.js";
import { classify, exitCodeFor, isBusy } from "./errors.js";
import { ConfigError } from "../core/index.js";
import { ID_PATTERN } from "../parser/index.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "geode-host-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("XDG paths", () => {
  it("uses the geodemd directory, while the command stays `geode`", () => {
    // The project is GeodeMD; the binary is deliberately the shorter `geode`.
    // These are two separate decisions and each is easy to change by accident.
    const env = { XDG_CONFIG_HOME: "/x/cfg", XDG_DATA_HOME: "/x/data" } as NodeJS.ProcessEnv;
    expect(configPath(env)).toBe(path.join("/x/cfg", "geodemd", "config.json"));
    expect(defaultDbPath(env)).toBe(path.join("/x/data", "geodemd", "db.sqlite"));
  });

  it("falls back to ~/.config and ~/.local/share when XDG is unset", () => {
    const home = os.homedir();
    expect(configPath({} as NodeJS.ProcessEnv)).toBe(
      path.join(home, ".config", "geodemd", "config.json"),
    );
    expect(defaultDbPath({} as NodeJS.ProcessEnv)).toBe(
      path.join(home, ".local", "share", "geodemd", "db.sqlite"),
    );
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
    await fs.writeFile(file, JSON.stringify({ notesPath: dir, device: "fixed-abcd" }), "utf8");
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

/**
 * The exit-code contract, which is the CLI's half of `ErrorKind`. Pinned as a
 * test because the mapping is "everything except `internal` is a 1" — so a new
 * kind gets the right code by default, and the one that would be WRONG by
 * default is a kind that should have been `internal`.
 */
describe("exit codes", () => {
  it("gives every user-fixable kind a 1, and only a bug a 2", () => {
    for (const kind of ["no-config", "config", "init-refused", "editor"] as const) {
      expect(exitCodeFor(kind), kind).toBe(1);
    }
    expect(exitCodeFor("internal")).toBe(2);
  });

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
