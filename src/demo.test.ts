/**
 * The demo collection is documentation, so it is checked like code.
 *
 * `demo/geodemd/syntax.md` claims a set of shapes are skipped. If that stops
 * being true the file becomes a lie in the most visible place in the
 * repository, and nothing else would notice — the parser's own tests use
 * inline fixtures and would keep passing.
 *
 * Read-only. This must never write a stamp into the demo, which is the whole
 * reason the folder says to copy it before syncing.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "./parser/index.js";
import type { ParsedCard } from "./parser/index.js";

const DEMO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "demo");

async function cardsIn(rel: string): Promise<ParsedCard[]> {
  return parse(await fs.readFile(path.join(DEMO, rel), "utf8"));
}

const questions = (cards: ParsedCard[]): string[] => cards.map((c) => c.question);

describe("the demo collection", () => {
  it("holds the number of cards its README advertises", async () => {
    const files = ["aws/lambda.md", "sqlite/wal.md", "geodemd/syntax.md", "archive/old-notes.md"];
    const counts = await Promise.all(files.map(async (f) => (await cardsIn(f)).length));
    expect(Object.fromEntries(files.map((f, i) => [f, counts[i]]))).toEqual({
      "aws/lambda.md": 7,
      "sqlite/wal.md": 6,
      "geodemd/syntax.md": 10,
      "archive/old-notes.md": 0,
    });
    expect(counts.reduce((a, b) => a + b, 0)).toBe(23);
  });

  it("is unstamped, so a reader sees what they would write themselves", async () => {
    // Also the guard that this test — or a stray sync in the repo — never
    // wrote into it.
    for (const f of ["aws/lambda.md", "sqlite/wal.md", "geodemd/syntax.md"]) {
      expect(await fs.readFile(path.join(DEMO, f), "utf8"), f).not.toMatch(/<!-- sr-/);
    }
  });
});

describe("syntax.md keeps its promises", () => {
  it("skips every shape it demonstrates", async () => {
    // Each of these appears in the file WITH a separator in it. Any of them
    // becoming a card is both a parser regression and a documentation lie.
    const answers = (await cardsIn("geodemd/syntax.md")).map((c) => c.answer).join("\n");
    const qs = questions(await cardsIn("geodemd/syntax.md")).join("\n");
    const all = `${qs}\n${answers}`;

    expect(all, "frontmatter").not.toContain("frontmatter is skipped");
    expect(all, "fenced code").not.toContain("geode   # not a card");
    expect(all, "indented code").not.toContain("512");
    expect(all, "table row").not.toContain("reports what it would do");
    expect(all, "blockquote").not.toContain("so quoting someone");
    expect(all, "heading").not.toContain("are skipped as well");
  });

  it("does not read the inline code span as a card", async () => {
    // "use `foo :: bar` to declare one" is prose ABOUT the syntax.
    const qs = questions(await cardsIn("geodemd/syntax.md"));
    expect(qs.some((q) => q.startsWith("use "))).toBe(false);
  });

  it("strips list markers and task boxes from the question", async () => {
    const qs = questions(await cardsIn("geodemd/syntax.md"));
    expect(qs).toContain("Where is the review log kept"); // "- "
    expect(qs).toContain("What is the database"); // "* "
    expect(qs).toContain("What does `geode rebuild` do"); // "1. "
    expect(qs).toContain("What happens to a card whose note you delete"); // "- [ ] "
    expect(qs).toContain("Does a stamp show up in rendered Markdown"); // "- [x] "
    expect(qs.every((q) => !/^[-*+\d]/.test(q))).toBe(true);
  });

  it("strips a trailing comment that is not a stamp", async () => {
    const card = (await cardsIn("geodemd/syntax.md")).find((c) =>
      c.question.includes("deferral window"),
    );
    expect(card?.answer).toBe("two seconds");
  });

  it("keeps a later separator as answer text", async () => {
    const card = (await cardsIn("geodemd/syntax.md")).find((c) =>
      c.question.includes("How is the separator split"),
    );
    expect(card?.answer).toContain("::");
  });
});
