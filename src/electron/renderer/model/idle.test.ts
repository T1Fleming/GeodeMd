import { describe, expect, it } from "vitest";
import { IDLE_RECHECK_MS } from "../../../host/queue.js";
import { checked, idle, nextCheckIn, showsResting, startCheck } from "./idle.js";

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
    expect(checked(startCheck(idle)!, { count: 2, capped: false }, 0).offer).toEqual({ count: 2, capped: false });
    expect(checked(startCheck(idle)!, { count: 0, capped: false }, 0).offer).toBeNull();
  });

  it("keeps what it showed when a check fails, and lets the next one start", () => {
    const shown = checked(startCheck(idle)!, { count: 3, capped: false }, 5);
    const failed = checked(startCheck(shown)!, null, 9);
    expect(failed).toEqual({ checking: false, offer: { count: 3, capped: false }, checkedAt: 5 });
  });
});

describe("the finished screen stops saying when a card comes back once it has", () => {
  const backAt = 1_000_000;
  const due = { count: 1, capped: false };

  it("says when it comes back before any check has answered", () => {
    expect(showsResting(idle, backAt)).toBe(true);
  });

  it("still says so after a check that ran before that time", () => {
    expect(showsResting(checked(startCheck(idle)!, { count: 0, capped: false }, backAt - 60_000), backAt)).toBe(true);
  });

  it("drops it once a check since that time offers the card as due now", () => {
    const offered = checked(startCheck(idle)!, due, backAt + 1_000);
    expect(offered.offer).toEqual(due);
    expect(showsResting(offered, backAt)).toBe(false);
  });

  it("drops it too when that check finds nothing due, since the card is no longer owed", () => {
    expect(showsResting(checked(startCheck(idle)!, { count: 0, capped: false }, backAt), backAt)).toBe(false);
  });

  it("keeps it when the check after that time failed, having learned nothing", () => {
    const before = checked(startCheck(idle)!, { count: 0, capped: false }, backAt - 60_000);
    expect(showsResting(checked(startCheck(before)!, null, backAt + 1_000), backAt)).toBe(true);
  });
});
