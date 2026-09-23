/**
 * The queue is pure and the clock is an argument, so every rule below is
 * testable without waiting ten minutes for a learning step to ripen — which is
 * the whole reason `now` is a parameter rather than something the queue reads.
 */

import { describe, expect, it } from "vitest";
import type { DueCard } from "../core/index.js";
import { FsrsScheduler, inShortTermSteps } from "../scheduler/index.js";
import { isEmpty, openQueue, owed, rated, scheduled, serve, setAside } from "./queue.js";
import type { ReviewQueue, Scheduled } from "./queue.js";

const card = (n: number): DueCard => ({
  id: `sr-00000000000${n}`,
  question: `Q${n}`,
  answer: `A${n}`,
  filePath: `${n}.md`,
  lineNo: n,
  locator: `${n}.md:${n}`,
});

const three = [card(1), card(2), card(3)];

const T0 = new Date("2026-09-22T12:00:00Z");
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);

/** What FSRS returns for a card still on a learning step. */
const learning = (minutes: number): Scheduled => ({
  due: at(minutes).toISOString(),
  state: 1,
});
/** And for one that graduated. */
const graduated: Scheduled = { due: at(16 * 1440).toISOString(), state: 2 };

const shown = (q: ReviewQueue, now: Date): string | null => serve(q, now)?.question ?? null;

describe("an unanswered queue", () => {
  it("serves the snapshot in order", () => {
    const q = openQueue(three);
    expect(shown(q, T0)).toBe("Q1");
    expect(owed(q)).toBe(3);
    expect(isEmpty(q)).toBe(false);
  });

  it("is empty when it was built from nothing", () => {
    const q = openQueue([]);
    expect(isEmpty(q)).toBe(true);
    expect(serve(q, T0)).toBeNull();
  });

  it("does not hold on to the caller's array", () => {
    const cards = [card(1)];
    const q = openQueue(cards);
    cards.push(card(2));
    expect(owed(q)).toBe(1);
  });
});

describe("a card that was rated", () => {
  it("leaves the screen at once, but is still owed until the scheduler answers", () => {
    // The gap matters: the renderer learns the new due time from an IPC round
    // trip that resolves after the keypress. A session that called itself
    // finished in that gap would end and then be handed a card to show.
    const q = rated(openQueue([card(1)]), card(1));
    expect(serve(q, T0)).toBeNull();
    expect(isEmpty(q)).toBe(false);
    expect(owed(q)).toBe(1);
  });

  it("comes back when FSRS put it on a learning step", () => {
    let q = rated(openQueue(three), card(1));
    q = scheduled(q, card(1).id, learning(10), T0);
    expect(owed(q)).toBe(3);

    // Not yet: ten minutes out, and two unseen cards are ahead of it.
    expect(shown(q, T0)).toBe("Q2");
    expect(shown(q, at(9))).toBe("Q2");
    // Now. A card whose time has come goes first — re-testing it is the point.
    expect(shown(q, at(10))).toBe("Q1");
  });

  it("is gone for the session once it graduates", () => {
    let q = rated(openQueue(three), card(1));
    q = scheduled(q, card(1).id, graduated, T0);
    expect(owed(q)).toBe(2);
    expect(shown(q, at(10_000))).toBe("Q2");
  });

  it("is gone when the new state could not be learned", () => {
    // A busy database costs the re-show, not the review: the rating is already
    // fsynced into the log by the time this is known.
    let q = rated(openQueue(three), card(1));
    q = scheduled(q, card(1).id, null, T0);
    expect(owed(q)).toBe(2);
    expect(shown(q, at(10_000))).toBe("Q2");
  });

  it("ignores an answer for a card that is not in flight", () => {
    const q = openQueue(three);
    expect(scheduled(q, card(1).id, learning(1), T0)).toBe(q);
  });

  it("is treated as due now if its due date will not parse", () => {
    // Otherwise it compares false against every clock and becomes a card the
    // session can neither show nor finish.
    let q = rated(openQueue([card(1)]), card(1));
    q = scheduled(q, card(1).id, { due: "not a date", state: 1 }, T0);
    expect(shown(q, T0)).toBe("Q1");
  });
});

describe("the end of the queue", () => {
  it("serves a waiting card early rather than idling", () => {
    // The chosen policy: nothing else is left, so show it now. No timer ever
    // has to fire, and the session stays finite.
    let q = rated(openQueue([card(1)]), card(1));
    q = scheduled(q, card(1).id, learning(10), T0);
    expect(shown(q, T0)).toBe("Q1");
  });

  it("serves the earliest of several early", () => {
    let q = openQueue([card(1), card(2)]);
    q = rated(q, card(1));
    q = rated(q, card(2));
    q = scheduled(q, card(1).id, learning(10), T0);
    q = scheduled(q, card(2).id, learning(5), T0);
    expect(shown(q, T0)).toBe("Q2");
  });

  it("is over only when every card has graduated", () => {
    let q = rated(openQueue([card(1)]), card(1));
    q = scheduled(q, card(1).id, learning(1), T0);
    expect(isEmpty(q)).toBe(false);
    q = rated(q, card(1));
    q = scheduled(q, card(1).id, graduated, at(1));
    expect(isEmpty(q)).toBe(true);
    expect(serve(q, at(1))).toBeNull();
  });
});

describe("the order waiting cards come back in", () => {
  it("is by due time, earliest first", () => {
    let q = openQueue(three);
    for (const c of three) q = rated(q, c);
    q = scheduled(q, card(1).id, learning(10), T0);
    q = scheduled(q, card(2).id, learning(1), T0);
    q = scheduled(q, card(3).id, learning(5), T0);

    expect(shown(q, at(1))).toBe("Q2");
    q = scheduled(rated(q, card(2)), card(2).id, graduated, at(1));
    expect(shown(q, at(5))).toBe("Q3");
  });

  it("keeps the order they were rated in when two are due together", () => {
    // Stable, so nothing swaps between one look and the next.
    let q = openQueue([card(1), card(2)]);
    q = rated(q, card(1));
    q = rated(q, card(2));
    q = scheduled(q, card(1).id, learning(5), T0);
    q = scheduled(q, card(2).id, learning(5), T0);
    expect(shown(q, at(5))).toBe("Q1");
  });
});

/** `0 later` — ADR 0022. Nothing about it is recorded anywhere. */
describe("setting a card aside", () => {
  it("moves it behind the cards not yet seen", () => {
    const q = setAside(openQueue(three), card(1));
    expect(shown(q, T0)).toBe("Q2");
    expect(owed(q)).toBe(3);
  });

  it("returns the only card there is, rather than pretending", () => {
    const q = setAside(openQueue([card(1)]), card(1));
    expect(shown(q, T0)).toBe("Q1");
    expect(isEmpty(q)).toBe(false);
  });

  it("takes a waiting card off its learning step, because it had ripened", () => {
    // It was on screen, so its time had come. "Later" with no rating to
    // position it by means the back of the line.
    let q = rated(openQueue([card(1), card(2)]), card(1));
    q = scheduled(q, card(1).id, learning(10), T0);
    expect(shown(q, at(10))).toBe("Q1");
    q = setAside(q, card(1));
    expect(shown(q, at(10))).toBe("Q2");
    q = rated(q, card(2));
    q = scheduled(q, card(2).id, graduated, at(10));
    expect(shown(q, at(10))).toBe("Q1");
  });

  it("comes back rather than pulling a waiting card early", () => {
    // There IS something else — two cards a minute out — and the deferred card
    // still wins, because serving waiting cards ahead of it is what would let a
    // card that keeps failing starve it for the rest of the session.
    let q = openQueue(three);
    q = scheduled(rated(q, card(2)), card(2).id, learning(1), T0);
    q = scheduled(rated(q, card(3)), card(3).id, learning(1), T0);
    q = setAside(q, card(1));
    expect(shown(q, T0)).toBe("Q1");
    // And a minute later the waiting cards take precedence, as always.
    expect(shown(q, at(1))).toBe("Q2");
  });

  it("never loses a card or invents one", () => {
    let q = openQueue(three);
    for (let i = 0; i < 20; i++) q = setAside(q, serve(q, T0)!);
    expect(owed(q)).toBe(3);
    expect(shown(q, T0)).toBe("Q3");
  });
});

/**
 * The assumption the whole design rests on, pinned rather than believed.
 *
 * `inShortTermSteps` is a state test, not a "due within N minutes" test, which
 * is only safe while the pinned parameters keep those states minutes away. If a
 * parameter change ever made a `Learning` card due tomorrow, the end-of-queue
 * rule would serve it a day early — so the two are checked against each other
 * here rather than trusted to stay in step.
 */
describe("the pinned parameters", () => {
  const scheduler = new FsrsScheduler();
  const minutesOut = (due: string, from: Date): number =>
    (new Date(due).getTime() - from.getTime()) / 60_000;

  it("keeps every short-term step inside the same sitting", () => {
    const steps: number[] = [];
    for (const rating of [1, 2, 3, 4] as const) {
      const next = scheduler.next(scheduler.initial(T0), rating, T0);
      if (inShortTermSteps(next)) steps.push(minutesOut(next.due, T0));
      else expect(minutesOut(next.due, T0)).toBeGreaterThan(1440);
    }
    // again 1, hard 5, good 10 — easy graduates and is not a step.
    expect(steps).toEqual([1, 5, 10]);
  });

  it("puts a lapsed review card back on one", () => {
    let state = scheduler.next(scheduler.initial(T0), 4, T0);
    const reviewedAt = new Date(state.due);
    state = scheduler.next(state, 1, reviewedAt);
    expect(inShortTermSteps(state)).toBe(true);
    expect(minutesOut(state.due, reviewedAt)).toBe(5);
  });
});
