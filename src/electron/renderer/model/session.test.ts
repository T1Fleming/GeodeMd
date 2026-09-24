/**
 * The session is pure, so this needs no React, no Electron and no DOM — the
 * whole reason the decisions live outside the component.
 *
 * The clock is an argument, which is what makes the learning steps testable at
 * all: a card due in ten minutes is ten minutes of wall clock away, and this
 * file just passes a later `now`.
 */

import { describe, expect, it } from "vitest";
import type { DueCard } from "../../../core/index.js";
import { begin, current, isOver, owed, press, reviewed, scheduled } from "./session.js";
import type { Session } from "./session.js";
import type { Scheduled } from "../../../host/queue.js";

const cards: DueCard[] = [
  { id: "sr-000000000001", question: "Q1", answer: "A1", filePath: "a.md", lineNo: 1, locator: "a.md:1" },
  { id: "sr-000000000002", question: "Q2", answer: "A2", filePath: "b.md", lineNo: 2, locator: "b.md:2" },
];

const three: DueCard[] = [
  ...cards,
  { id: "sr-000000000003", question: "Q3", answer: "A3", filePath: "c.md", lineNo: 3, locator: "c.md:3" },
];

const T0 = new Date("2026-09-22T12:00:00Z");
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);

/** A keypress at `T0`, which is what most of these tests care about. */
const tap = (s: Session, key: string, now: Date = T0): ReturnType<typeof press> =>
  press(s, key, now);
const after = (s: Session, key: string, now: Date = T0): Session => tap(s, key, now).next;

/** What FSRS says for a card still on a learning step, and for one that is not. */
const learning = (minutes: number): Scheduled => ({
  due: at(minutes).toISOString(),
  state: 1,
});
const graduated: Scheduled = { due: at(16 * 1440).toISOString(), state: 2 };

/** Rate the card on screen and report what the scheduler decided. */
function rate(s: Session, key: "1" | "2" | "3" | "4", next: Scheduled | null, now = T0): Session {
  const card = current(s)!;
  const revealed = after(s, " ", now);
  const rated = after(revealed, key, now);
  return scheduled(rated, card.id, next, now);
}

const upcoming = (s: Session): string[] => s.queue.fresh.map((c) => c.question);

describe("revealing", () => {
  it("starts hidden, because the point is to recall it first", () => {
    const s = begin(cards);
    expect(s.revealed).toBe(false);
    expect(current(s)?.question).toBe("Q1");
  });

  it("reveals on any key that is not a quit", () => {
    for (const key of [" ", "Enter", "x", "3", "o"]) {
      expect(after(begin(cards), key).revealed, key).toBe(true);
    }
  });

  it("quits from the question too, not only from the answer", () => {
    // A question you cannot get out of without answering it is not what the
    // legend promises. This is the one key the "any key reveals" rule excludes.
    const s = after(begin(cards), "q");
    expect(s.quit).toBe(true);
    expect(isOver(s)).toBe(true);
  });
});

describe("rating", () => {
  it("does nothing before the answer is showing", () => {
    // The first press revealed; a rating here would be for an answer the user
    // has not seen, which is worse than ignoring the key.
    const s = tap(begin(cards), "3");
    expect(s.effect).toBeUndefined();
    expect(reviewed(s.next)).toBe(0);
    expect(current(s.next)?.question).toBe("Q1");
  });

  it("records the rating and moves on once revealed", () => {
    const revealed = after(begin(cards), " ");
    const { next, effect } = tap(revealed, "3");
    expect(effect).toEqual({ kind: "rate", cardId: "sr-000000000001", rating: 3 });
    expect(current(next)?.question).toBe("Q2");
    expect(next.revealed).toBe(false);
    expect(reviewed(next)).toBe(1);
  });

  it("is over when every card has graduated", () => {
    let s = begin(cards);
    s = rate(s, "4", graduated);
    s = rate(s, "4", graduated);
    expect(isOver(s)).toBe(true);
    expect(current(s)).toBeNull();
    expect(reviewed(s)).toBe(2);
  });
});

/**
 * FSRS's short-term steps, honoured — ADR 0023.
 *
 * Our pinned parameters put a new card rated *again* one minute out, *hard*
 * five and *good* ten, all of them still `Learning`. The scheduler has been
 * saying so all along; until this the session computed it and threw it away.
 */
describe("a card on a learning step", () => {
  it("comes back in the same session", () => {
    let s = rate(begin(three), "3", learning(10)); // Q1 owed again at +10
    expect(owed(s)).toBe(3);
    expect(current(s)?.question).toBe("Q2");

    // Answered before its time has come: the next unseen card follows.
    s = rate(s, "4", graduated, at(9));
    expect(current(s)?.question).toBe("Q3");

    // Answered after it: the card that was owed comes round again.
    s = rate(s, "4", graduated, at(11));
    expect(current(s)?.question).toBe("Q1");
    expect(isOver(s)).toBe(false);
  });

  it("goes ahead of a card that has not been seen yet, once it is due", () => {
    // Holding the re-test behind thirty unseen cards would defeat the step.
    let s = rate(begin(three), "3", learning(10)); // Q1 owed again at +10
    s = rate(s, "4", graduated, at(10)); // answer Q2 exactly then
    expect(current(s)?.question).toBe("Q1");
  });

  it("does not replace the card being read the moment it ripens", () => {
    // The clock is read on a keypress, never while drawing. A card that
    // changed under someone mid-read would be answered against the wrong one.
    let s = rate(begin(three), "3", learning(1));
    const showing = current(s)?.question;
    s = scheduled(s, "sr-000000000001", learning(1), at(5));
    expect(current(s)?.question).toBe(showing);
  });

  it("is answered again, and counted again", () => {
    let s = begin([cards[0]!]);
    s = rate(s, "1", learning(1));
    expect(isOver(s)).toBe(false);
    // Nothing else left, so it is served early rather than idling.
    expect(current(s)?.question).toBe("Q1");
    s = rate(s, "3", graduated, at(1));
    expect(isOver(s)).toBe(true);
    expect(reviewed(s)).toBe(2);
    expect(s.counts).toEqual({ 1: 1, 2: 0, 3: 1, 4: 0 });
  });

  it("makes the counter's denominator grow, because a second answer is owed", () => {
    const s = begin(three);
    expect(reviewed(s) + owed(s)).toBe(3);
    const rated = rate(s, "3", learning(10));
    expect(reviewed(rated) + owed(rated)).toBe(4);
  });

  it("keeps the session alive while the rating is in flight", () => {
    // The gap between the keypress and the scheduler's answer. A session that
    // ended here would end and then be handed a card to show.
    const revealed = after(begin([cards[0]!]), " ");
    const inFlight = tap(revealed, "1").next;
    expect(isOver(inFlight)).toBe(false);
    expect(current(inFlight)).toBeNull();

    const back = scheduled(inFlight, "sr-000000000001", learning(1), T0);
    expect(current(back)?.question).toBe("Q1");
  });

  it("does not come back when the scheduler graduated it", () => {
    const s = rate(begin(cards), "4", graduated);
    expect(owed(s)).toBe(1);
    expect(current(after(s, "x", at(10_000)))?.question).toBe("Q2");
  });

  it("does not come back when the write failed and its state is unknown", () => {
    // A busy database costs the re-show, not the review.
    const s = rate(begin(cards), "1", null);
    expect(owed(s)).toBe(1);
    expect(current(s)?.question).toBe("Q2");
  });

  it("ignores a key pressed while nothing is on screen", () => {
    const revealed = after(begin([cards[0]!]), " ");
    const inFlight = tap(revealed, "1").next;
    const pressed = tap(inFlight, "3");
    expect(pressed.effect).toBeUndefined();
    expect(pressed.next).toBe(inFlight);
  });
});

describe("opening the note", () => {
  it("is offered only once the answer is showing, like the CLI", () => {
    const hidden = tap(begin(cards), "o");
    expect(hidden.effect).toBeUndefined();
    expect(hidden.next.revealed).toBe(true); // it revealed instead

    const shown = tap(hidden.next, "o");
    expect(shown.effect).toEqual({ kind: "open", card: cards[0] });
  });

  it("records each opened note once, for the end-of-session check", () => {
    let s = after(begin(cards), " ");
    s = after(s, "o");
    s = after(s, "o");
    expect(s.opened).toEqual(["a.md"]);
  });

  it("does not advance the card", () => {
    // The editor scribbled over nothing here, but the rating still has to be
    // given against the card that is showing.
    const s = after(begin(cards), " ");
    const opened = after(s, "o");
    expect(current(opened)?.question).toBe("Q1");
    expect(opened.revealed).toBe(true);
  });
});

describe("keys it does not know", () => {
  it("ignores them once revealed rather than guessing", () => {
    const s = after(begin(cards), " ");
    for (const key of ["5", "0", "z", "ArrowLeft"]) {
      const pressed = tap(s, key);
      expect(pressed.effect, key).toBeUndefined();
      expect(current(pressed.next)?.question, key).toBe("Q1");
    }
  });

  it("does nothing at all once the session is over", () => {
    const over = after(begin(cards), "q");
    expect(after(over, "3")).toBe(over);
  });
});

describe("an empty queue", () => {
  it("is over immediately, with nothing to show", () => {
    const s = begin([]);
    expect(isOver(s)).toBe(true);
    expect(current(s)).toBeNull();
    expect(after(s, "3")).toBe(s);
  });
});

/**
 * `0` — later.
 *
 * The one key that moves a card without saying anything about your memory.
 * It exists because "I am not ready to answer this" is a real state that no
 * rating expresses: grading a card you never attempted as a lapse would be a
 * lie, and grading it as anything else would be a worse one.
 */
describe("deferring", () => {
  it("moves the card to the back and shows the next one", () => {
    const s = after(begin(three), "0");
    expect(upcoming(s)).toEqual(["Q2", "Q3", "Q1"]);
    expect(current(s)?.question).toBe("Q2");
  });

  it("does not advance the counter, because nothing was answered", () => {
    const s = after(begin(three), "0");
    expect(reviewed(s)).toBe(0);
    expect(owed(s)).toBe(3);
  });

  it("records nothing at all — no effect, no rating", () => {
    // The whole reason this is cheap: no log line, no FSRS fold, no write.
    const { effect, next } = tap(begin(three), "0");
    expect(effect).toBeUndefined();
    expect(next.counts).toEqual(begin(three).counts);
  });

  it("is the second exception to `any key reveals`", () => {
    // `q` is the first. Everything else flips the card over.
    expect(after(begin(cards), "0").revealed).toBe(false);
  });

  it("does nothing once the answer is showing", () => {
    // Deferring a card you have already read the answer to would make the
    // next sighting a sham test — you would rate a success you did not earn,
    // and FSRS would believe it.
    const revealed = after(begin(three), " ");
    expect(after(revealed, "0")).toBe(revealed);
    expect(upcoming(after(revealed, "0"))).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("keeps the session alive — a deferred card is still owed an answer", () => {
    let s = begin(cards);
    for (let i = 0; i < 5; i++) s = after(s, "0");
    expect(isOver(s)).toBe(false);
    expect(owed(s)).toBe(2);
  });

  it("comes back round, so the card is genuinely still reachable", () => {
    let s = begin(three);
    s = after(s, "0"); // Q1 to the back
    s = after(s, "0"); // Q2 to the back
    expect(current(s)?.question).toBe("Q3");
    s = after(s, "0");
    expect(current(s)?.question).toBe("Q1");
  });

  it("returns the only remaining card immediately, rather than pretending", () => {
    // Nothing else to show is the honest answer to "show me something else".
    const one = rate(begin([cards[0]!]), "4", graduated);
    expect(isOver(one)).toBe(true);

    const solo = after(begin([cards[0]!]), "0");
    expect(current(solo)?.question).toBe("Q1");
    expect(isOver(solo)).toBe(false);
  });

  it("still lets the card be answered normally afterwards", () => {
    const s = after(begin(three), "0"); // defer Q1
    const revealed = after(s, " "); // reveal Q2
    const rated = tap(revealed, "3");
    expect(rated.effect).toEqual({ kind: "rate", cardId: "sr-000000000002", rating: 3 });
    expect(current(rated.next)?.question).toBe("Q3");
  });

  it("does not lose a card that was deferred and then answered", () => {
    let s = begin(cards);
    s = after(s, "0"); // Q1 to the back
    s = rate(s, "4", graduated); // answer Q2
    expect(current(s)?.question).toBe("Q1");
    s = rate(s, "4", graduated); // answer Q1
    expect(isOver(s)).toBe(true);
    expect(reviewed(s)).toBe(2);
  });

  it("works on a card that came back on a learning step", () => {
    let s = rate(begin(cards), "3", learning(10)); // Q1 owed again at +10
    s = after(s, "0", at(10)); // defer Q2, and Q1's time has come
    expect(current(s)?.question).toBe("Q1");

    // Deferred, it loses the step it had already served and goes to the back.
    s = after(s, "0", at(10));
    expect(current(s)?.question).toBe("Q2");
    expect(upcoming(s)).toEqual(["Q2", "Q1"]);
    expect(owed(s)).toBe(2);
  });
});
