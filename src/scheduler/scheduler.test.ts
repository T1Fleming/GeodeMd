import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { default_w, generatorParameters } from "ts-fsrs";
import { fold, FSRS_PARAMS, FsrsScheduler, SCHEDULER_VERSION, TS_FSRS_VERSION } from "./index.js";

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
  });

  it("calls itself by the library and every parameter, so changing either is noticed", () => {
    const s = new FsrsScheduler();
    expect(s.version).toBe(SCHEDULER_VERSION);
    expect(SCHEDULER_VERSION).toContain(`ts-fsrs@${TS_FSRS_VERSION}`);
    expect(SCHEDULER_VERSION).toContain(JSON.stringify(FSRS_PARAMS.w));
    expect(SCHEDULER_VERSION).toContain(JSON.stringify(FSRS_PARAMS.learning_steps));
  });
});

/**
 * ADR 0039: fuzz is on, so things rated alike stop coming due together — and
 * it is drawn from a seed written in source, so a rebuild still reproduces
 * every schedule exactly.
 */
describe("fuzz spreads due dates, and every replay draws the same fuzz", () => {
  const T = new Date("2026-10-05T08:00:00.000Z");
  const day = 86_400_000;

  /** A history of ratings, a day or more apart, from a seeded generator. */
  function history(seed: number, length: number): Array<{ rated_at: string; rating: number }> {
    let s = seed;
    const rand = (): number => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    let t = T.getTime();
    return Array.from({ length }, () => {
      t += Math.floor(1 + rand() * 40) * day + Math.floor(rand() * day);
      return { rated_at: new Date(t).toISOString(), rating: 1 + Math.floor(rand() * 4) };
    });
  }

  it("draws the same schedule from the same history, every time", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const h = history(seed, 12);
      const a = fold(new FsrsScheduler(), `sr-${seed}`, null, h, T);
      const b = fold(new FsrsScheduler(), `sr-${seed}`, null, h, T);
      expect(b).toEqual(a);
    }
  });

  it("draws the same schedule replaying from a midpoint as from the start", () => {
    // What ingest does: fold the new reviews onto the stored state (ADR 0012).
    for (let seed = 1; seed <= 200; seed++) {
      const h = history(seed, 12);
      const whole = fold(new FsrsScheduler(), `sr-${seed}`, null, h, T);
      const half = fold(new FsrsScheduler(), `sr-${seed}`, null, h.slice(0, 5), T);
      expect(fold(new FsrsScheduler(), `sr-${seed}`, half, h.slice(5), T)).toEqual(whole);
    }
  });

  it("parts cards rated alike at the same moments onto different days", () => {
    const h = [3, 3, 3].map((rating, i) => ({ rated_at: new Date(T.getTime() + i * 10 * day).toISOString(), rating }));
    const dues = new Set(
      Array.from({ length: 40 }, (_, i) => fold(new FsrsScheduler(), `sr-${i}`, null, h, T).due.slice(0, 10)),
    );
    expect(dues.size).toBeGreaterThan(3);
  });

  it("never moves a short-term step", () => {
    for (let i = 0; i < 40; i++) {
      const s = new FsrsScheduler().next(new FsrsScheduler().initial(T), 3, T, `sr-${i}`);
      expect(new Date(s.due).getTime() - T.getTime()).toBe(10 * 60_000);
    }
  });

  it("draws exactly these dates, so a change in the library's fuzz is noticed", () => {
    // Pinned values, like the weights: a ts-fsrs bump that changed its fuzz
    // ranges or its generator would move every due date, and must fail here.
    const h = [4, 3, 3, 2].map((rating, i) => ({ rated_at: new Date(T.getTime() + i * 20 * day).toISOString(), rating }));
    expect(fold(new FsrsScheduler(), "sr-000000000001", null, h, T).due).toBe("2027-05-15T08:00:00.000Z");
    expect(fold(new FsrsScheduler(), "sr-000000000002", null, h, T).due).toBe("2027-05-20T08:00:00.000Z");
  });
});
