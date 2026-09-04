import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { formatSummary, interpretKey, LEGEND, parseArgs } from "./index.js";
import {
  defaultDevice,
  initConfig,
  InitRefused,
  newId,
  readConfig,
} from "./config.js";
import { ID_PATTERN } from "../parser/index.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "geode-cli-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("parseArgs", () => {
  it("reads a command and positionals", () => {
    const a = parseArgs(["init", "/notes"]);
    expect(a.command).toBe("init");
    expect(a.positional).toEqual(["/notes"]);
  });

  it("reads flags in any position", () => {
    const a = parseArgs(["sync", "--full", "--dry-run"]);
    expect(a.flags.has("full")).toBe(true);
    expect(a.flags.has("dry-run")).toBe(true);
  });

  it("reads -n and --limit", () => {
    expect(parseArgs(["review", "-n", "10"]).limit).toBe(10);
    expect(parseArgs(["review", "--limit", "25"]).limit).toBe(25);
    expect(parseArgs(["review", "--limit=7"]).limit).toBe(7);
  });

  it("ignores a nonsense limit rather than crashing", () => {
    expect(parseArgs(["review", "-n", "zero"]).limit).toBeUndefined();
    expect(parseArgs(["review", "-n", "-5"]).limit).toBeUndefined();
  });
});

describe("newId", () => {
  it("mints the shape section 4 specifies", () => {
    for (let i = 0; i < 100; i++) expect(newId()).toMatch(ID_PATTERN);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 1000 }, newId));
    expect(seen.size).toBe(1000);
  });
});

describe("defaultDevice", () => {
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

describe("init", () => {
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

  it("returns null for a missing or malformed config", async () => {
    expect(await readConfig(path.join(dir, "nope.json"))).toBeNull();
    const bad = path.join(dir, "bad.json");
    await fs.writeFile(bad, "{ not json", "utf8");
    expect(await readConfig(bad)).toBeNull();
  });
});

describe("formatSummary", () => {
  const base = {
    filesEnumerated: 10,
    filesUnchanged: 9,
    filesRead: 1,
    filesDeferred: 0,
    cardsFound: 3,
    cardsNew: 1,
    cardsUpdated: 0,
    cardsPruned: 0,
    reconciled: false,
    duplicatesReminted: 0,
    symlinkedDirsSkipped: 0,
    logShardsSkipped: 0,
    logBytesRead: 0,
    reviewsIngested: 0,
    filesSkippedOnError: 0,
    logLinesSkipped: 0,
    elapsedMs: 4,
  };

  it("always reports the core counts", () => {
    expect(formatSummary(base)).toBe(
      "10 files (9 unchanged, 1 read), 3 cards found, 1 new, 0 updated — 4ms",
    );
  });

  it("surfaces skipped files, which the exit code deliberately does not", () => {
    expect(formatSummary({ ...base, filesSkippedOnError: 2 })).toContain(
      "2 files skipped on error",
    );
  });

  it("stays quiet about zero-valued incidentals", () => {
    expect(formatSummary(base)).not.toContain("pruned");
    expect(formatSummary(base)).not.toContain("deferred");
  });
});

describe("interpretKey", () => {
  it("maps 1-4 to ratings", () => {
    for (const k of ["1", "2", "3", "4"]) {
      expect(interpretKey(k)).toEqual({ kind: "rate", rating: Number(k) });
    }
  });

  it("quits on q, Q, escape and Ctrl-C", () => {
    for (const k of ["q", "Q", "escape", String.fromCharCode(3)]) {
      expect(interpretKey(k)).toEqual({ kind: "quit" });
    }
  });

  it("ignores anything else rather than recording a wrong rating", () => {
    for (const k of ["5", "0", "x", " ", ""]) {
      expect(interpretKey(k)).toEqual({ kind: "ignore" });
    }
  });

  it("names all four FSRS ratings in the legend", () => {
    // They are not guessable from their numbers.
    for (const word of ["again", "hard", "good", "easy"]) {
      expect(LEGEND).toContain(word);
    }
  });
});
