import { describe, expect, it } from "vitest";
import {
  ACTION_KEYS,
  emptyCounts,
  interpretKey,
  RATING_KEYS,
  ratingBreakdown,
} from "./present.js";

describe("interpretKey", () => {
  it("maps 1-4 to ratings", () => {
    expect(interpretKey("1")).toEqual({ kind: "rate", rating: 1 });
    expect(interpretKey("4")).toEqual({ kind: "rate", rating: 4 });
  });

  it("quits on q, Q, Ctrl-C, and escape in both spellings", () => {
    // The terminal's readline reports "escape"; the DOM's KeyboardEvent.key
    // reports "Escape". Both interfaces pass their raw key straight in, so
    // both spellings have to mean the same thing or the GUI silently ignores
    // a key the CLI honours.
    for (const k of ["q", "Q", String.fromCharCode(3), "escape", "Escape"]) {
      expect(interpretKey(k), k).toEqual({ kind: "quit" });
    }
  });

  it("opens the source note on o", () => {
    expect(interpretKey("o")).toEqual({ kind: "open" });
    expect(interpretKey("O")).toEqual({ kind: "open" });
  });

  it("ignores anything else rather than recording a rating nobody chose", () => {
    for (const k of ["5", "0", "x", " ", "Enter", "ArrowDown", ""]) {
      expect(interpretKey(k), k).toEqual({ kind: "ignore" });
    }
  });
});

describe("the shared vocabulary", () => {
  it("names all four FSRS ratings, in order", () => {
    // Spec section 9: the numbers are not guessable, so the words travel with
    // them. Both interfaces read this table rather than writing their own.
    expect(RATING_KEYS.map(([k]) => k)).toEqual(["1", "2", "3", "4"]);
    expect(RATING_KEYS.map(([, l]) => l)).toEqual(["again", "hard", "good", "easy"]);
  });

  it("agrees with interpretKey about every key it advertises", () => {
    // A legend that disagrees with the handler is worse than no legend.
    for (const [key] of RATING_KEYS) {
      expect(interpretKey(key).kind, key).toBe("rate");
    }
    for (const [key, label] of ACTION_KEYS) {
      expect(interpretKey(key).kind, key).toBe(label);
    }
  });
});

describe("ratingBreakdown", () => {
  it("stays quiet about ratings that were never given", () => {
    const counts = { ...emptyCounts(), 3: 5 };
    expect(ratingBreakdown(counts)).toEqual([{ label: "good", count: 5 }]);
  });

  it("reports in rating order, not insertion order", () => {
    const counts = { 1: 2, 2: 0, 3: 1, 4: 7 };
    expect(ratingBreakdown(counts).map((r) => r.label)).toEqual(["again", "good", "easy"]);
  });

  it("is empty for a session with no answers in it", () => {
    expect(ratingBreakdown(emptyCounts())).toEqual([]);
  });
});
