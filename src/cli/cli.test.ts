import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  deferralNote,
  formatSummary,
  interpretKey,
  isEntryPoint,
  LEGEND,
  parseArgs,
} from "./index.js";

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

describe("deferralNote", () => {
  const base = {
    filesEnumerated: 1,
    filesUnchanged: 0,
    filesRead: 1,
    filesDeferred: 0,
    cardsFound: 3,
    cardsNew: 0,
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
    elapsedMs: 1,
  };

  it("says nothing when nothing was deferred", () => {
    expect(deferralNote(base)).toBeNull();
  });

  it("explains a deferral and says what to do about it", () => {
    // "3 cards found, 0 new" reads as a failure without this.
    const note = deferralNote({ ...base, filesDeferred: 1 })!;
    expect(note).toContain("1 file was");
    expect(note).toContain("geode sync");
  });

  it("agrees with itself about plurals", () => {
    expect(deferralNote({ ...base, filesDeferred: 2 })!).toContain("2 files were");
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

  it("opens the source note on o", () => {
    expect(interpretKey("o")).toEqual({ kind: "open" });
    expect(interpretKey("O")).toEqual({ kind: "open" });
  });

  it("ignores anything else rather than recording a wrong rating", () => {
    for (const k of ["5", "9", "x", " ", ""]) {
      expect(interpretKey(k)).toEqual({ kind: "ignore" });
    }
  });

  it("names all four FSRS ratings in the legend", () => {
    // They are not guessable from their numbers.
    for (const word of ["again", "hard", "good", "easy"]) {
      expect(LEGEND).toContain(word);
    }
  });

  it("offers the source note in the legend, since nothing else advertises it", () => {
    expect(LEGEND).toContain("open");
  });
});

describe("isEntryPoint", () => {
  it("recognises the module when invoked through a symlink", async () => {
    // `npm link` puts a symlink on PATH, so argv[1] is the link while
    // import.meta.url is the resolved file. Comparing them unresolved makes the
    // installed binary silently do nothing.
    const real = path.join(dir, "real.js");
    const link = path.join(dir, "link.js");
    await fs.writeFile(real, "", "utf8");
    await fs.symlink(real, link);

    expect(isEntryPoint(pathToFileURL(real).href, link)).toBe(true);
    expect(isEntryPoint(pathToFileURL(real).href, real)).toBe(true);
  });

  it("is false for an unrelated entry, or none at all", async () => {
    const a = path.join(dir, "a.js");
    const b = path.join(dir, "b.js");
    await fs.writeFile(a, "", "utf8");
    await fs.writeFile(b, "", "utf8");

    expect(isEntryPoint(pathToFileURL(a).href, b)).toBe(false);
    expect(isEntryPoint(pathToFileURL(a).href, undefined)).toBe(false);
    expect(isEntryPoint(pathToFileURL(a).href, path.join(dir, "missing.js"))).toBe(false);
  });
});
