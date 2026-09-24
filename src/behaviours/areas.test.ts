/**
 * The taxonomy is complete and stays complete.
 *
 * `docs/design/behaviours.md` is only worth reading if every behaviour is in it,
 * and the way a generated document like that dies is quietly: someone adds a test
 * file, nothing classifies it, and it is missing from the index for a year. So
 * an unclassified group is a **failing test**, not a warning in a log.
 *
 * Source text rather than the run's own task tree, for the same reason
 * `boundaries.test.ts` scans text: a single test cannot see the whole suite from
 * inside it, and it does not need to — a top-level `describe` is a line at column
 * zero.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AREAS, BY_FILE, BY_GROUP, areaFor } from "./areas.js";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function testFiles(dir = SRC): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await testFiles(child)));
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(path.relative(SRC, child));
  }
  return out.sort();
}

/**
 * Top-level `describe`s: a call at column zero. Nested ones are indented.
 *
 * Everything between `describe` and the first quote is skipped rather than
 * matched, because a group can be `describe.skipIf(!ENABLED)("…")` — as
 * `enumerate.bench.test.ts` is, which is how the first version of this scan came
 * to report zero groups for that file while passing.
 */
async function topLevelGroups(rel: string): Promise<string[]> {
  const text = await fs.readFile(path.join(SRC, rel), "utf8");
  return [...text.matchAll(/^describe[^"'`\n]*(["'`])(.+?)\1/gm)].map((m) => m[2]!);
}

/** This file classifies itself; excluding it would be the first thing to rot. */
const ALL = await testFiles();

describe("every behaviour has a home", () => {
  it("classifies every test file", () => {
    const missing = ALL.filter((f) => !(f in BY_FILE));
    expect(
      missing,
      `add these to BY_FILE in src/behaviours/areas.ts:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("classifies every group in every file", async () => {
    const orphans: string[] = [];
    for (const file of ALL) {
      for (const group of await topLevelGroups(file)) {
        if (!areaFor(file, group)) orphans.push(`${file}:${group}`);
      }
    }
    expect(
      orphans,
      `these groups have no area:\n  ${orphans.join("\n  ")}`,
    ).toEqual([]);
  });

  it("finds groups in every file it classifies, so the scan cannot silently fail", async () => {
    // The regex is the weak point: if a file ever writes its top-level
    // `describe` differently — indented, or built from a variable — this scan
    // would report zero groups and the rule above would pass while checking
    // nothing. Same failure mode `boundaries.test.ts` guards against by asserting
    // its own scan finds something.
    for (const file of ALL) {
      expect(await topLevelGroups(file), `no top-level describe found in ${file}`).not.toEqual([]);
    }
  });
});

describe("the taxonomy itself", () => {
  it("points every file and override at an area that exists", () => {
    const names = new Set(AREAS.map((a) => a.name));
    for (const [key, area] of Object.entries({ ...BY_FILE, ...BY_GROUP })) {
      expect(names, `${key} points at "${area}", which is not in AREAS`).toContain(area);
    }
  });

  it("names a file that exists for every override", () => {
    // An override whose file was renamed stops applying and says nothing.
    for (const key of Object.keys(BY_GROUP)) {
      const file = key.slice(0, key.lastIndexOf(":"));
      expect(ALL, `override for a file that is gone: ${key}`).toContain(file);
    }
  });

  it("names a group that exists for every override", async () => {
    for (const key of Object.keys(BY_GROUP)) {
      const at = key.lastIndexOf(":");
      const [file, group] = [key.slice(0, at), key.slice(at + 1)];
      expect(await topLevelGroups(file), `override for a group that is gone: ${key}`).toContain(
        group,
      );
    }
  });

  it("keeps every area in use", () => {
    // An area nobody files anything under is a heading with nothing beneath it,
    // and the document reads as if something is missing.
    const used = new Set(Object.values({ ...BY_FILE, ...BY_GROUP }));
    for (const area of AREAS) {
      expect(used, `nothing is filed under "${area.name}"`).toContain(area.name);
    }
  });

  it("gives every area a blurb, because a bare heading explains nothing", () => {
    for (const area of AREAS) expect(area.blurb.length).toBeGreaterThan(20);
  });
});
