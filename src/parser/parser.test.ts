import { describe, expect, it } from "vitest";
import { parse, parseLine, readStamp, splitLines, stampLine } from "./index.js";

/**
 * Spec section 10, "Parser". Fixture strings in, expected cards out.
 * Every bullet in that list has a test here.
 */

const ID = "sr-a7Kd9mQ2xR4v";

describe("the basic form", () => {
  it("splits on the first separator and trims both sides", () => {
    expect(parse("Default Lambda timeout >> 3 seconds")).toEqual([
      { id: null, question: "Default Lambda timeout", answer: "3 seconds", lineIndex: 0, context: [] },
    ]);
  });

  it("reports a 0-based lineIndex", () => {
    const cards = parse("intro\n\nQ >> A\n");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.lineIndex).toBe(2);
  });

  it("finds multiple cards in one document", () => {
    const cards = parse("A >> 1\nprose\nB >> 2\n");
    expect(cards.map((c) => c.question)).toEqual(["A", "B"]);
    expect(cards.map((c) => c.lineIndex)).toEqual([0, 2]);
  });
});

describe("`>>` and `==` both make a forward card", () => {
  it.each([
    ["Q >> A", "Q", "A"],
    ["Q == A", "Q", "A"],
    ["- Covalent bond == a shared pair of electrons", "Covalent bond", "a shared pair of electrons"],
  ])("%s", (line, question, answer) => {
    expect(parse(line)).toEqual([{ id: null, question, answer, lineIndex: 0, context: [] }]);
  });

  it("splits on whichever separator comes first", () => {
    expect(parse("Q == A >> more")[0]!.answer).toBe("A >> more");
    expect(parse("Q >> A == more")[0]!.answer).toBe("A == more");
  });
});

describe("a separator without whitespace on both sides is not a separator", () => {
  it.each(["foo>>bar", "a ==b", "a== b", "x<<y >>z", "key::value in a field"])("%s", (line) => {
    expect(parse(line)).toEqual([]);
  });
});

describe("a backslash keeps a separator literal", () => {
  it.each(["x \\== y", "a \\>> b", "- if x \\== y then stop"])("%s", (line) => {
    expect(parse(line)).toEqual([]);
  });

  it("still splits on an unescaped separator later in the line", () => {
    const cards = parse("Is x \\== y true? >> only when both are 3");
    expect(cards[0]!.question).toBe("Is x \\== y true?");
  });
});

describe("`::` is not a card", () => {
  it.each(["Mitochondria :: produce ATP", `- Q :: A <!-- ${ID} -->`])("%s", (line) => {
    expect(parse(line)).toEqual([]);
  });
});

describe("RemNote's other tokens are not forward cards", () => {
  it.each([
    "Q >>> A",
    "Q >>- A",
    "Q ==- A",
    "Q ==A) A",
    "Q >>A) A",
    "Q >>1. A",
    "Q << A",
    "Q <> A",
    "Q ;; A",
  ])("%s", (line) => {
    expect(parse(line)).toEqual([]);
  });
});

describe("a later separator is answer text", () => {
  it("keeps `>>` in the answer — one line is always at most one card", () => {
    const cards = parse("Shift right >> C++ writes it as a >> b");
    expect(cards).toEqual([
      { id: null, question: "Shift right", answer: "C++ writes it as a >> b", lineIndex: 0, context: [] },
    ]);
  });
});

describe("leading list markers are stripped from the question", () => {
  it.each([
    ["- Q >> A", "Q"],
    ["* Q >> A", "Q"],
    ["+ Q >> A", "Q"],
    ["1. Q >> A", "Q"],
    ["12. Q >> A", "Q"],
    ["1) Q >> A", "Q"],
    ["- [ ] Q >> A", "Q"],
    ["- [x] Q >> A", "Q"],
    ["  - Q >> A", "Q"],
  ])("%s", (line, question) => {
    const cards = parse(line);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.question).toBe(question);
  });
});

describe("an empty side is not a card", () => {
  it.each([" >> A", "Q >> ", " >> ", "- >> A"])("%j", (line) => {
    expect(parse(line)).toEqual([]);
  });

  it("is empty when the answer is nothing but a comment", () => {
    expect(parse("Q >> <!-- TODO -->")).toEqual([]);
  });
});

describe("stamps", () => {
  it("keeps an existing id and excludes it from the answer", () => {
    const cards = parse(`Q >> A <!-- ${ID} -->`);
    expect(cards).toEqual([{ id: ID, question: "Q", answer: "A", lineIndex: 0, context: [] }]);
  });

  it("strips a non-stamp trailing comment from the answer", () => {
    const cards = parse("Q >> 3 seconds <!-- TODO check -->");
    expect(cards[0]!.answer).toBe("3 seconds");
    expect(cards[0]!.id).toBeNull();
  });

  it("strips a trailing comment that sits after a stamp", () => {
    const cards = parse(`Q >> 3 seconds <!-- TODO --> <!-- ${ID} -->`);
    expect(cards[0]!.answer).toBe("3 seconds");
    expect(cards[0]!.id).toBe(ID);
  });

  it("does not read a bare ^token as a stamp", () => {
    // Section 4's original hazard, kept as a regression test: this must be a
    // card whose answer is the literal text, not a stamped card.
    const cards = parse("Anchor for start of line >> ^abc");
    expect(cards).toEqual([
      { id: null, question: "Anchor for start of line", answer: "^abc", lineIndex: 0, context: [] },
    ]);
  });

  it.each([
    ["wrong length", "<!-- sr-tooshort -->"],
    ["no prefix", "<!-- a7Kd9mQ2xR4v -->"],
    ["illegal char", "<!-- sr-a7Kd9mQ2xR4! -->"],
    ["not at end of line", `<!-- ${ID} --> trailing`],
  ])("is not a stamp: %s", (_name, comment) => {
    const cards = parse(`Q >> A ${comment}`);
    expect(cards[0]!.id).toBeNull();
  });
});

describe("skipped contexts", () => {
  it("skips fenced code blocks", () => {
    expect(parse("```sh\nfoo >> bar\n```\n")).toEqual([]);
  });

  it("skips tilde-fenced code blocks", () => {
    expect(parse("~~~\nfoo >> bar\n~~~\n")).toEqual([]);
  });

  it("resumes after a fence closes", () => {
    const cards = parse("```\nin >> code\n```\nout >> here\n");
    expect(cards.map((c) => c.question)).toEqual(["out"]);
  });

  it("does not close a backtick fence with a tilde fence", () => {
    expect(parse("```\n~~~\nfoo >> bar\n")).toEqual([]);
  });

  it("skips indented code blocks (four spaces)", () => {
    expect(parse("    aws s3 cp a >> b\n")).toEqual([]);
  });

  it("skips indented code blocks (tab)", () => {
    expect(parse("\taws s3 cp a >> b\n")).toEqual([]);
  });

  it("skips a separator inside an inline code span", () => {
    expect(parse("Use `foo >> bar` to declare it")).toEqual([]);
  });

  it("still parses a card whose answer contains a closed code span", () => {
    const cards = parse("Separator >> written as `::` in prose");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.answer).toBe("written as `::` in prose");
  });

  it("skips table rows", () => {
    expect(parse("| Timeout >> 3s | note |")).toEqual([]);
  });

  it("skips blockquotes and headings", () => {
    expect(parse("> quoted >> line\n# heading >> line\n")).toEqual([]);
  });

  it("skips YAML frontmatter", () => {
    expect(parse("---\ntitle >> something\n---\n")).toEqual([]);
  });

  it("parses cards after frontmatter closes", () => {
    const cards = parse("---\ntitle >> skipped\n---\nreal >> card\n");
    expect(cards.map((c) => c.question)).toEqual(["real"]);
  });

  it("does not swallow the note when frontmatter is never closed", () => {
    // Section 3: "If there is no closing delimiter, the file has no
    // frontmatter; do not swallow the whole note."
    const cards = parse("---\nQ >> A\nmore >> cards\n");
    expect(cards.map((c) => c.question)).toEqual(["Q", "more"]);
  });

  it("treats `---` below line 1 as ordinary text, not frontmatter", () => {
    const cards = parse("intro\n---\nQ >> A\n");
    expect(cards.map((c) => c.question)).toEqual(["Q"]);
  });
});

describe("bullets nested under other bullets are cards at any depth", () => {
  const questions = (text: string) => parse(text).map((c) => c.question);

  it("reads a card four spaces deep under a parent bullet", () => {
    const note = "- Cell\n  - Nucleus >> holds DNA\n    - Nucleolus >> makes ribosomes\n";
    expect(questions(note)).toEqual(["Nucleus", "Nucleolus"]);
  });

  it("reads a card a tab deep under a parent bullet", () => {
    expect(questions("- Cell\n\t- Nucleus >> holds DNA\n")).toEqual(["Nucleus"]);
  });

  it("reads cards several levels deep, with tabs and spaces mixed", () => {
    const note = "- a\n\t- b\n\t  - c\n\t\t- d\n\t\t\t- deep >> yes\n";
    expect(questions(note)).toEqual(["deep"]);
  });

  it("reads nested ordered items and task boxes", () => {
    const note = "1. Cell\n   1. Nucleus\n      - [ ] Nucleolus >> makes ribosomes\n";
    expect(questions(note)).toEqual(["Nucleolus"]);
  });

  it("keeps the list open across blank lines between items", () => {
    expect(questions("- Cell\n\n    - Nucleus >> holds DNA\n")).toEqual(["Nucleus"]);
  });

  it("returns to a shallower level after a deep one", () => {
    const note = "- a\n  - b\n    - deep >> 1\n  - mid >> 2\n    - deep again >> 3\n";
    expect(questions(note)).toEqual(["deep", "mid", "deep again"]);
  });
});

describe("indented code near a list stays skipped", () => {
  const questions = (text: string) => parse(text).map((c) => c.question);

  it("skips a marker line indented four or more columns past its parent's text", () => {
    // `- ` puts the parent's text at column 2; column 6 is code inside the item.
    expect(questions("- Haskell example\n\n      - f >> Int\n")).toEqual([]);
  });

  it("skips indented lines that are not bullets, even inside a list", () => {
    expect(questions("- Cell\n    Nucleus >> holds DNA\n")).toEqual([]);
  });

  it("skips an indented bullet once a paragraph has ended the list", () => {
    expect(questions("- Cell\n\nA paragraph.\n\n    - Nucleus >> holds DNA\n")).toEqual([]);
  });

  it("skips an indented bullet once a heading has ended the list", () => {
    expect(questions("- Cell\n# Next\n    - Nucleus >> holds DNA\n")).toEqual([]);
  });

  it("skips an indented bullet once a fence at the margin has ended the list", () => {
    expect(questions("- Cell\n```\nx\n```\n    - Nucleus >> holds DNA\n")).toEqual([]);
  });

  it("does not mistake a horizontal rule for a bullet", () => {
    expect(questions("* * *\n    - Nucleus >> holds DNA\n")).toEqual([]);
    expect(questions("- - -\n    - Nucleus >> holds DNA\n")).toEqual([]);
  });

  it("skips an indented bullet with no list above it", () => {
    expect(questions("Intro\n\n    - Nucleus >> holds DNA\n")).toEqual([]);
  });

  it("leaves every shallower line as it was", () => {
    const note = "- Cell\n  continued >> text\nplain >> card\n  - two >> deep\n";
    expect(questions(note)).toEqual(["continued", "plain", "two"]);
  });
});

describe("a card's context is the headings and bullets above it", () => {
  const contextOf = (text: string, question: string) =>
    parse(text).find((c) => c.question === question)!.context;

  it("is the parent bullets, outermost first, under the headings", () => {
    const note = "# Biology\n- Cell\n  - Nucleus >> holds DNA\n    - Nucleolus >> makes ribosomes\n";
    expect(contextOf(note, "Nucleolus")).toEqual([
      { text: "Biology" },
      { text: "Cell" },
      { text: "Nucleus", answer: "holds DNA" },
    ]);
    expect(contextOf(note, "Nucleus")).toEqual([{ text: "Biology" }, { text: "Cell" }]);
  });

  it("is empty for a card with no heading or bullet above it", () => {
    expect(parse("Q >> A\n")[0]!.context).toEqual([]);
  });

  it("gives a card outside a list the headings above it", () => {
    expect(contextOf("# A\n## B\nQ >> x\n", "Q")).toEqual([{ text: "A" }, { text: "B" }]);
  });

  it("replaces a heading with the next one at its level, and clears deeper ones", () => {
    const note = "# A\n## B\n### C\n## D\nQ >> x\n";
    expect(contextOf(note, "Q")).toEqual([{ text: "A" }, { text: "D" }]);
  });

  it("skips a level that was never opened", () => {
    expect(contextOf("# A\n### C\nQ >> x\n", "Q")).toEqual([{ text: "A" }, { text: "C" }]);
  });

  it("strips a closing sequence, comments and stamps from what it shows", () => {
    const note = `# Cells ## <!-- x -->\n- [ ] Nucleus >> holds DNA <!-- ${ID} -->\n  - Q >> A\n`;
    expect(contextOf(note, "Q")).toEqual([
      { text: "Cells" },
      { text: "Nucleus", answer: "holds DNA" },
    ]);
  });

  it("shows only the term of a `::` ancestor, as a Concept card would", () => {
    const note = "- Mitochondria :: produce ATP\n  - where >> the cytoplasm\n";
    expect(contextOf(note, "where")).toEqual([{ text: "Mitochondria" }]);
  });

  it("drops a bullet that leaves the list, and a sibling is not a parent", () => {
    const note = "- a\n  - b\n- c\n  - Q >> x\n";
    expect(contextOf(note, "Q")).toEqual([{ text: "c" }]);
  });

  it("drops the list at a heading", () => {
    const note = "- a\n# H\n- Q >> x\n";
    expect(contextOf(note, "Q")).toEqual([{ text: "H" }]);
  });

  it("keeps a parent across blank lines between items", () => {
    expect(contextOf("- a\n\n  - Q >> x\n", "Q")).toEqual([{ text: "a" }]);
  });

  it("leaves out an empty bullet", () => {
    expect(contextOf("-\n  - Q >> x\n", "Q")).toEqual([]);
  });

  it.each([
    ["a heading in a fence", "```\n# not\n```\nQ >> x\n"],
    ["a heading in a blockquote", "> # not\nQ >> x\n"],
    ["a heading in frontmatter", "---\n# not\n---\nQ >> x\n"],
    ["a tag, which is not a heading", "#not\nQ >> x\n"],
  ])("does not take %s", (_name, note) => {
    expect(contextOf(note, "Q")).toEqual([]);
  });

  it("does not take a heading inside a list item", () => {
    expect(contextOf("- a\n  # inner\n  - Q >> x\n", "Q")).toEqual([{ text: "a" }]);
  });
});

describe("splitLines keeps each terminator", () => {
  it("preserves LF", () => {
    expect(splitLines("a\nb\n")).toEqual(["a\n", "b\n"]);
  });

  it("preserves CRLF", () => {
    expect(splitLines("a\r\nb\r\n")).toEqual(["a\r\n", "b\r\n"]);
  });

  it("preserves a missing final terminator", () => {
    expect(splitLines("a\nb")).toEqual(["a\n", "b"]);
  });

  it("preserves a mixed file byte-for-byte when rejoined", () => {
    const text = "a\r\nb\nc";
    expect(splitLines(text).join("")).toBe(text);
  });

  it("returns nothing for empty input", () => {
    expect(splitLines("")).toEqual([]);
  });
});

describe("writing a stamp into a line", () => {
  it("appends a stamp to an unstamped line", () => {
    expect(stampLine("Q >> A", ID)).toBe(`Q >> A <!-- ${ID} -->`);
  });

  it("replaces an existing stamp rather than appending a second", () => {
    // Section 4: the naive implementation produces `<!-- old --> <!-- new -->`.
    const other = "sr-BBBBBBBBBBBB";
    expect(stampLine(`Q >> A <!-- ${ID} -->`, other)).toBe(`Q >> A <!-- ${other} -->`);
  });

  it("leaves a non-stamp comment in place and stamps after it", () => {
    expect(stampLine("Q >> A <!-- TODO -->", ID)).toBe(`Q >> A <!-- TODO --> <!-- ${ID} -->`);
  });

  it("does not accumulate whitespace", () => {
    expect(stampLine("Q >> A   ", ID)).toBe(`Q >> A <!-- ${ID} -->`);
  });

  it("rejects an id that is not the minted shape", () => {
    expect(() => stampLine("Q >> A", "nope")).toThrow(/valid card id/);
  });

  it("round-trips: a stamped line parses back to the same id and answer", () => {
    const stamped = stampLine("Q >> A", ID);
    expect(parseLine(stamped, 0)).toEqual({ id: ID, question: "Q", answer: "A", lineIndex: 0, context: [] });
  });
});

describe("reading a stamp back off a line", () => {
  it("returns the id and the remainder", () => {
    // `rest` is the raw remainder; trimming is the caller's business.
    expect(readStamp(`Q >> A <!-- ${ID} -->`)).toEqual({ id: ID, rest: "Q >> A " });
  });

  it("returns null when there is no stamp", () => {
    expect(readStamp("Q >> A")).toBeNull();
  });
});
