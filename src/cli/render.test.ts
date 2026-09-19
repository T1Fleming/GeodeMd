import { describe, expect, it } from "vitest";
import type { DueCard } from "../core/index.js";
import {
  emptyCounts,
  LEGEND,
  renderAnswer,
  renderHeader,
  renderPrompt,
  renderStaleNote,
  renderSummary,
} from "./render.js";
import { PLAIN, styler } from "./style.js";

const card: DueCard = {
  id: "sr-000000000001",
  question: "What is the average case runtime of quicksort?",
  answer: "O(n log n)",
  filePath: "algorithms/Sorting.md",
  lineNo: 142,
  locator: "algorithms/Sorting.md:142",
};

describe("renderPrompt", () => {
  it("repeats where you are in the session, and where the card came from", () => {
    // The count printed once at the top of a fifty-card session is no help by
    // card thirty.
    const out = renderPrompt(card, 2, 12, PLAIN, 60);
    expect(out).toContain("2/12");
    expect(out).toContain("algorithms/Sorting.md:142");
    expect(out).toContain("What is the average case runtime of quicksort?");
  });

  it("wraps the question to the width instead of the terminal edge", () => {
    const long = { ...card, question: "word ".repeat(40).trim() };
    for (const line of renderPrompt(long, 1, 1, PLAIN, 40).split("\n")) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });
});

describe("renderAnswer", () => {
  it("shows the answer and the legend together", () => {
    const out = renderAnswer(card, PLAIN, 60);
    expect(out).toContain("O(n log n)");
    expect(out).toContain(LEGEND);
  });
});

describe("LEGEND", () => {
  it("names every key the loop actually accepts", () => {
    for (const word of ["again", "hard", "good", "easy", "open", "quit"]) {
      expect(LEGEND).toContain(word);
    }
    expect(LEGEND).toContain("o open");
  });

  it("is plain text, so a pipe gets no escape sequences", () => {
    expect(LEGEND).not.toContain(String.fromCharCode(27));
    expect(renderAnswer(card, styler(true), 60)).toContain(String.fromCharCode(27));
  });
});

describe("renderSummary", () => {
  it("counts the session and breaks it down by rating", () => {
    const out = renderSummary({ ...emptyCounts(), 1: 1, 3: 8 }, PLAIN);
    expect(out).toContain("9 reviewed");
    expect(out).toContain("1 again");
    expect(out).toContain("8 good");
  });

  it("stays quiet about ratings you never gave", () => {
    const out = renderSummary({ ...emptyCounts(), 3: 2 }, PLAIN);
    expect(out).toContain("2 reviewed");
    expect(out).not.toContain("hard");
  });

  it("says something honest about a session with no answers in it", () => {
    expect(renderSummary(emptyCounts(), PLAIN)).toContain("0 reviewed");
  });
});

describe("renderStaleNote", () => {
  it("says nothing when nothing changed", () => {
    // Concatenated with the summary unconditionally, so it has to be empty
    // rather than a blank line.
    expect(renderStaleNote([], PLAIN)).toBe("");
  });

  it("names the one note that changed, and counts several", () => {
    expect(renderStaleNote(["algorithms/Sorting.md"], PLAIN)).toContain("algorithms/Sorting.md");
    expect(renderStaleNote(["a.md"], PLAIN)).toContain("geode sync");
    const many = renderStaleNote(["a.md", "b.md", "c.md"], PLAIN);
    expect(many).toContain("3 notes");
    expect(many).not.toContain("a.md");
  });
});

describe("renderHeader", () => {
  it("reports the queue against the backlog it came from", () => {
    expect(renderHeader(50, 1240, PLAIN)).toContain("50 of 1240 due");
  });
});
