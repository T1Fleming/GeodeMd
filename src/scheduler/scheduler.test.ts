import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { default_w, generatorParameters } from "ts-fsrs";
import { FSRS_PARAMS, FsrsScheduler, SCHEDULER_VERSION, TS_FSRS_VERSION } from "./index.js";

/**
 * ADR 0007's rule, and ADR 0028's version of it: the scheduler is FSRS-6 from
 * one exact ts-fsrs, with every parameter written down — and what is written
 * down is what runs.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function json(rel: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(ROOT, rel), "utf8")) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the scheduler is FSRS-6, pinned", () => {
  it("names the ts-fsrs that package.json pins, exactly, and the one installed", async () => {
    const deps = (await json("package.json"))["dependencies"] as Record<string, string>;
    expect(deps["ts-fsrs"]).toBe(TS_FSRS_VERSION);
    expect((await json("node_modules/ts-fsrs/package.json"))["version"]).toBe(TS_FSRS_VERSION);
  });

  it("runs the 21 weights it writes down — FSRS-6's defaults, neither padded nor clipped", () => {
    // Equal to the library's defaults because that was the decision (ADR
    // 0028), not because they are inherited: a ts-fsrs bump that moves
    // `default_w` fails here, which is the moment to decide again.
    expect(FSRS_PARAMS.w).toHaveLength(21);
    expect([...FSRS_PARAMS.w]).toEqual([...default_w]);
  });

  it("leaves ts-fsrs nothing to fill in, and so nothing to log", () => {
    // Given 19 weights, ts-fsrs 5 pads to 21 and says so on console.debug.
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(generatorParameters({ ...FSRS_PARAMS })).toEqual(FSRS_PARAMS);
    expect(debug).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("pins the short-term steps ADR 0023's same-sitting re-show is built on", () => {
    expect(FSRS_PARAMS.enable_short_term).toBe(true);
    expect([...FSRS_PARAMS.learning_steps]).toEqual(["1m", "10m"]);
    expect([...FSRS_PARAMS.relearning_steps]).toEqual(["10m"]);
    expect(FSRS_PARAMS.enable_fuzz).toBe(false);
  });

  it("calls itself by the library and every parameter, so changing either is noticed", () => {
    const s = new FsrsScheduler();
    expect(s.version).toBe(SCHEDULER_VERSION);
    expect(SCHEDULER_VERSION).toContain(`ts-fsrs@${TS_FSRS_VERSION}`);
    expect(SCHEDULER_VERSION).toContain(JSON.stringify(FSRS_PARAMS.w));
    expect(SCHEDULER_VERSION).toContain(JSON.stringify(FSRS_PARAMS.learning_steps));
  });
});
