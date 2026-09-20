/**
 * The session is pure, so this needs no React, no Electron and no DOM — the
 * whole reason the decisions live outside the component.
 */

import { describe, expect, it } from "vitest";
import type { DueCard } from "../../../core/index.js";
import { begin, current, isOver, press, reviewed } from "./session.js";

const cards: DueCard[] = [
  { id: "sr-000000000001", question: "Q1", answer: "A1", filePath: "a.md", lineNo: 1, locator: "a.md:1" },
  { id: "sr-000000000002", question: "Q2", answer: "A2", filePath: "b.md", lineNo: 2, locator: "b.md:2" },
];

describe("revealing", () => {
  it("starts hidden, because the point is to recall it first", () => {
    const s = begin(cards);
    expect(s.revealed).toBe(false);
    expect(current(s)?.question).toBe("Q1");
  });

  it("reveals on any key that is not a quit", () => {
    for (const key of [" ", "Enter", "x", "3", "o"]) {
      expect(press(begin(cards), key).next.revealed, key).toBe(true);
    }
  });

  it("quits from the question too, not only from the answer", () => {
    // A question you cannot get out of without answering it is not what the
    // legend promises. This is the one key the "any key reveals" rule excludes.
    const s = press(begin(cards), "q").next;
    expect(s.quit).toBe(true);
    expect(isOver(s)).toBe(true);
  });
});

describe("rating", () => {
  it("does nothing before the answer is showing", () => {
    // The first press revealed; a rating here would be for an answer the user
    // has not seen, which is worse than ignoring the key.
    const s = begin(cards);
    const after = press(s, "3");
    expect(after.effect).toBeUndefined();
    expect(reviewed(after.next)).toBe(0);
    expect(after.next.at).toBe(0);
  });

  it("records the rating and advances once revealed", () => {
    let s = press(begin(cards), " ").next;
    const { next, effect } = press(s, "3");
    expect(effect).toEqual({ kind: "rate", cardId: "sr-000000000001", rating: 3 });
    expect(next.at).toBe(1);
    expect(next.revealed).toBe(false);
    expect(reviewed(next)).toBe(1);
  });

  it("does not re-show a card rated again in the same session", () => {
    // The queue is a snapshot and FSRS puts a lapsed card minutes out.
    // Re-queueing here would be learning-steps logic, which is out of scope.
    let s = press(begin(cards), " ").next;
    s = press(s, "1").next;
    expect(current(s)?.question).toBe("Q2");
    expect(s.counts[1]).toBe(1);
  });

  it("is over when the queue runs out", () => {
    let s = begin(cards);
    for (let i = 0; i < 2; i++) {
      s = press(s, " ").next;
      s = press(s, "3").next;
    }
    expect(isOver(s)).toBe(true);
    expect(current(s)).toBeNull();
    expect(reviewed(s)).toBe(2);
  });
});

describe("opening the note", () => {
  it("is offered only once the answer is showing, like the CLI", () => {
    const hidden = press(begin(cards), "o");
    expect(hidden.effect).toBeUndefined();
    expect(hidden.next.revealed).toBe(true); // it revealed instead

    const shown = press(hidden.next, "o");
    expect(shown.effect).toEqual({ kind: "open", card: cards[0] });
  });

  it("records each opened note once, for the end-of-session check", () => {
    let s = press(begin(cards), " ").next;
    s = press(s, "o").next;
    s = press(s, "o").next;
    expect(s.opened).toEqual(["a.md"]);
  });

  it("does not advance the card", () => {
    // The editor scribbled over nothing here, but the rating still has to be
    // given against the card that is showing.
    let s = press(begin(cards), " ").next;
    const after = press(s, "o").next;
    expect(after.at).toBe(0);
    expect(after.revealed).toBe(true);
  });
});

describe("keys it does not know", () => {
  it("ignores them once revealed rather than guessing", () => {
    let s = press(begin(cards), " ").next;
    for (const key of ["5", "0", "z", "ArrowLeft"]) {
      const after = press(s, key);
      expect(after.effect, key).toBeUndefined();
      expect(after.next.at, key).toBe(0);
    }
  });

  it("does nothing at all once the session is over", () => {
    const over = press(begin(cards), "q").next;
    expect(press(over, "3").next).toBe(over);
  });
});

describe("an empty queue", () => {
  it("is over immediately, with nothing to show", () => {
    const s = begin([]);
    expect(isOver(s)).toBe(true);
    expect(current(s)).toBeNull();
    expect(press(s, "3").next).toBe(s);
  });
});
