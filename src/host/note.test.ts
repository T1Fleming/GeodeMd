import { describe, expect, it } from "vitest";
import { cardLineNote, noteMarkdown } from "./note.js";

const MARK = "geode-card";

describe("the note's Markdown as the viewer renders it", () => {
  it("marks the card's line, and only that line", () => {
    const text = "# Sorting\n\nIntro line.\nQuicksort :: O(n log n) <!-- sr-aaaaaaaaaaaa -->\nAfter.\n";
    expect(noteMarkdown(text, 4, MARK)).toBe(
      `# Sorting\n\nIntro line.\n<mark id="${MARK}">Quicksort :: O(n log n)</mark>\nAfter.\n`,
    );
  });

  it("marks after a list marker or task box, so the list still renders as one", () => {
    const text = "- a :: b <!-- sr-aaaaaaaaaaaa -->\n  - [ ] c :: d <!-- sr-bbbbbbbbbbbb -->\n3. e :: f\n";
    expect(noteMarkdown(text, 2, MARK).split("\n")[1]).toBe(`  - [ ] <mark id="${MARK}">c :: d</mark>`);
    expect(noteMarkdown(text, 3, MARK).split("\n")[2]).toBe(`3. <mark id="${MARK}">e :: f</mark>`);
  });

  it("shows no stamp anywhere, on the card's line or any other", () => {
    const text = "a :: b <!-- sr-aaaaaaaaaaaa -->\nc :: d <!-- sr-bbbbbbbbbbbb -->\n";
    const out = noteMarkdown(text, 1, MARK);
    expect(out).not.toMatch(/sr-[A-Za-z0-9]{12}/);
    expect(out).not.toContain("<!--");
    // An ordinary comment is the user's, and stays.
    expect(noteMarkdown("x <!-- todo -->\n", null, MARK)).toBe("x <!-- todo -->\n");
  });

  it("drops frontmatter, which would render as a rule and a heading made of YAML", () => {
    const text = "---\ntitle: Sorting\n---\nq :: a\n";
    expect(noteMarkdown(text, 4, MARK)).toBe(`\n\n\n<mark id="${MARK}">q :: a</mark>\n`);
  });

  it("keeps each line's own terminator, so a CRLF note keeps its line numbers", () => {
    const text = "one\r\nq :: a <!-- sr-aaaaaaaaaaaa -->\r\nthree";
    expect(noteMarkdown(text, 2, MARK)).toBe(`one\r\n<mark id="${MARK}">q :: a</mark>\r\nthree`);
  });

  it("marks nothing when the card was not found", () => {
    const text = "q :: a\n";
    expect(noteMarkdown(text, null, MARK)).toBe(text);
  });

  it("refuses a marker id that could break out of the attribute", () => {
    expect(() => noteMarkdown("q :: a\n", 1, `x" onmouseover="alert(1)`)).toThrow();
  });
});

describe("what the viewer says about where the card is", () => {
  it("says nothing when the card is where the last sync left it", () => {
    expect(cardLineNote(4, 4)).toBeNull();
  });

  it("says so when the note changed and the card moved", () => {
    expect(cardLineNote(4, 9)).toContain("now on line 9");
  });

  it("says so, rather than pointing at the wrong line, when the card is gone", () => {
    expect(cardLineNote(4, null)).toContain("nothing is highlighted");
  });
});
