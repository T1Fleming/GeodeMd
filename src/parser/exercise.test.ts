import { describe, expect, it } from "vitest";
import { parseExercise, stampExerciseId } from "./exercise.js";
import { parse } from "./index.js";

/** The ADR's example note, solution and all. */
const NOTE = `---
form: exercise
geode-skills: [monotonic-stack]
source: https://leetcode.com/problems/daily-temperatures/
---
# Daily Temperatures

Given daily temperatures, return for each day how many days until a warmer one.

### Constraints

1 <= n <= 10^5

## Solution

Keep a stack of indices still waiting for a warmer day.
`;

describe("a note becomes an exercise only by naming its skills", () => {
  it("reads the skills, the title, and the statement up to ## Solution", () => {
    expect(parseExercise(NOTE)).toEqual({
      kind: "exercise",
      skills: ["monotonic-stack"],
      id: null,
      title: "Daily Temperatures",
      statement:
        "Given daily temperatures, return for each day how many days until a warmer one.\n\n" +
        "### Constraints\n\n1 <= n <= 10^5",
    });
  });

  it("is an ordinary note without properties, without geode-skills, or with an empty list", () => {
    expect(parseExercise("# Daily Temperatures\n\n## Solution\n")).toEqual({ kind: "none" });
    expect(parseExercise("---\nform: exercise\n---\n# T\n## Solution\n")).toEqual({ kind: "none" });
    expect(parseExercise("---\ngeode-skills: []\n---\n# T\n## Solution\n")).toEqual({ kind: "none" });
  });

  it("ignores form, so a user's own form: exercise makes nothing an exercise", () => {
    expect(parseExercise("---\nform: exercise\ntags: [geode-skills]\n---\n# T\n## Solution\n")).toEqual({
      kind: "none",
    });
  });

  it("reads a block list as well as a flow list, trimmed and without repeats", () => {
    const note = "---\ngeode-skills:\n  - two-pointers\n  - ' greedy '\n  - two-pointers\n---\n# T\nS\n## Solution\n";
    expect(parseExercise(note)).toMatchObject({ kind: "exercise", skills: ["two-pointers", "greedy"] });
  });

  it("reads only the properties block on line 1, not a geode-skills line in the body", () => {
    expect(parseExercise("# T\n\ngeode-skills: [greedy]\n\n## Solution\n")).toEqual({ kind: "none" });
    expect(parseExercise("intro\n---\ngeode-skills: [greedy]\n---\n## Solution\n")).toEqual({ kind: "none" });
  });

  it("keeps CRLF out of what it reads", () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    expect(parseExercise(crlf)).toEqual(parseExercise(NOTE));
  });
});

describe("an exercise that cannot be read is reported, not guessed at", () => {
  it("is unreadable when the properties do not parse", () => {
    expect(parseExercise("---\ngeode-skills: [greedy\n---\n# T\n## Solution\n")).toEqual({ kind: "unreadable" });
  });

  it("is unreadable when geode-skills is not a list of non-blank strings", () => {
    for (const value of ["greedy", "[1, 2]", "[greedy, '']", "{a: b}"]) {
      expect(parseExercise(`---\ngeode-skills: ${value}\n---\n# T\n## Solution\n`), value).toEqual({
        kind: "unreadable",
      });
    }
  });

  it("is left out of every pool without ## Solution, so a spot review cannot show the solution", () => {
    expect(parseExercise("---\ngeode-skills: [greedy]\n---\n# T\n\nThe whole answer.\n")).toEqual({
      kind: "no-solution",
      skills: ["greedy"],
    });
    // A different level-2 heading does not end the statement either.
    expect(parseExercise("---\ngeode-skills: [greedy]\n---\n# T\n## Approach\nx\n")).toMatchObject({
      kind: "no-solution",
    });
  });
});

describe("where an exercise's statement ends", () => {
  it("matches ## Solution in any case, with trailing spaces or closing hashes", () => {
    for (const heading of ["## solution", "## SOLUTION  ", "## Solution ##"]) {
      const note = `---\ngeode-skills: [g]\n---\n# T\nS\n${heading}\nanswer\n`;
      expect(parseExercise(note), heading).toMatchObject({ kind: "exercise", statement: "S" });
    }
  });

  it("ends at a heading that gives the answer away, above ## Solution", () => {
    // Seen in use (#81): "## Intuition" put "a fixed-size sliding window" on the question screen.
    for (const spoiler of ["## Intuition", "## Approach", "## Hints", "## hint", "## Explanation ##"]) {
      const note = `---\ngeode-skills: [g]\n---\n# T\nS\n${spoiler}\nthe skill, named\n## Solution\nanswer\n`;
      expect(parseExercise(note), spoiler).toMatchObject({ kind: "exercise", title: "T", statement: "S" });
    }
  });

  it("keeps the problem's own sections, like ## Examples, in the statement", () => {
    const note = "---\ngeode-skills: [g]\n---\n# T\nS\n## Examples\nin -> out\n## Approach\nx\n## Solution\ny\n";
    expect(parseExercise(note)).toMatchObject({ statement: "S\n## Examples\nin -> out" });
  });

  it("still needs ## Solution when a spoiler heading ends the statement", () => {
    const note = "---\ngeode-skills: [g]\n---\n# T\nS\n## Approach\nx\n";
    expect(parseExercise(note)).toEqual({ kind: "no-solution", skills: ["g"] });
  });

  it("does not end at a ## Solution inside a fenced block", () => {
    const note = "---\ngeode-skills: [g]\n---\n# T\n```md\n## Solution\n```\nmore\n## Solution\nanswer\n";
    expect(parseExercise(note)).toMatchObject({ statement: "```md\n## Solution\n```\nmore" });
  });

  it("starts straight after the properties when the note has no title", () => {
    expect(parseExercise("---\ngeode-skills: [g]\n---\nJust the problem.\n## Solution\n")).toEqual({
      kind: "exercise",
      skills: ["g"],
      id: null,
      title: null,
      statement: "Just the problem.",
    });
  });

  it("leaves ordinary cards in an exercise note to the card parser", () => {
    const note = `${NOTE}\n- Why it is linear >> each index is pushed once and popped once\n`;
    expect(parse(note).map((c) => c.question)).toEqual(["Why it is linear"]);
    expect(parseExercise(note)).toMatchObject({ kind: "exercise" });
  });
});

describe("an exercise's id in its properties", () => {
  const ID = "sr-AbCdEf123456";

  it("is read when valid, and ignored when not", () => {
    const note = (v: string) => `---\ngeode-skills: [g]\ngeode-id: ${v}\n---\n# T\nS\n## Solution\nA\n`;
    expect(parseExercise(note(ID))).toMatchObject({ kind: "exercise", id: ID });
    expect(parseExercise(note("foo"))).toMatchObject({ kind: "exercise", id: null });
  });

  it("is added as one line before the closing ---, leaving every other byte alone", () => {
    const note = "---\ngeode-skills: [g]   # mine\nsource: x\n---\n# T\nS\n## Solution\nA\n";
    expect(stampExerciseId(note, ID)).toBe("---\ngeode-skills: [g]   # mine\nsource: x\ngeode-id: " + ID + "\n---\n# T\nS\n## Solution\nA\n");
  });

  it("replaces an existing geode-id line rather than adding a second key", () => {
    const note = "---\ngeode-id: foo\ngeode-skills: [g]\n---\n# T\n## Solution\n";
    const out = stampExerciseId(note, ID);
    expect(out).toBe("---\ngeode-id: " + ID + "\ngeode-skills: [g]\n---\n# T\n## Solution\n");
    expect(parseExercise(out)).toMatchObject({ id: ID });
  });

  it("keeps a CRLF note CRLF", () => {
    const note = "---\r\ngeode-skills: [g]\r\n---\r\n# T\r\n## Solution\r\n";
    expect(stampExerciseId(note, ID)).toBe("---\r\ngeode-skills: [g]\r\ngeode-id: " + ID + "\r\n---\r\n# T\r\n## Solution\r\n");
  });
});
