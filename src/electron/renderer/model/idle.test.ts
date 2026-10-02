import { describe, expect, it } from "vitest";
import { IDLE_RECHECK_MS } from "../../../host/queue.js";
import { checked, idle, nextCheckIn, startCheck } from "./idle.js";

describe("when a screen with no card checks for cards coming due", () => {
  const now = 1_000_000;

  it("checks every regular interval when it knows no due time", () => {
    expect(nextCheckIn(now, null)).toBe(IDLE_RECHECK_MS);
  });

  it("wakes just after a known due time inside the next interval", () => {
    const delay = nextCheckIn(now, now + 30_000);
    expect(delay).toBeGreaterThan(30_000);
    expect(delay).toBeLessThan(32_000);
  });

  it("wakes after, never on, a due time exactly one interval away", () => {
    expect(nextCheckIn(now, now + IDLE_RECHECK_MS)).toBeGreaterThan(IDLE_RECHECK_MS);
  });

  it("checks at the regular interval when the due time is further off", () => {
    expect(nextCheckIn(now, now + 6 * 60_000)).toBe(IDLE_RECHECK_MS);
  });

  it("falls back to the regular interval once the due time has passed, never zero", () => {
    expect(nextCheckIn(now, now - 5_000)).toBe(IDLE_RECHECK_MS);
    expect(nextCheckIn(now, now)).toBe(IDLE_RECHECK_MS);
  });
});

describe("what a check offers", () => {
  it("starts only one check at a time", () => {
    const running = startCheck(idle)!;
    expect(running.checking).toBe(true);
    expect(startCheck(running)).toBeNull();
  });

  it("offers cards that are due, and nothing when none are", () => {
    expect(checked(startCheck(idle)!, { count: 2, capped: false }).offer).toEqual({ count: 2, capped: false });
    expect(checked(startCheck(idle)!, { count: 0, capped: false }).offer).toBeNull();
  });

  it("keeps what it showed when a check fails, and lets the next one start", () => {
    const shown = checked(startCheck(idle)!, { count: 3, capped: false });
    const failed = checked(startCheck(shown)!, null);
    expect(failed).toEqual({ checking: false, offer: { count: 3, capped: false } });
  });
});
