/**
 * The journey `docs/guides/first-sync.md` describes, held to what it says.
 *
 * This is the guide with real stakes — the first sync edits every note that holds
 * a card — so its examples are the ones a reader will trust most and the ones it
 * would be worst to get wrong. Each test below reads them out of the guide and
 * puts them through the real parser and a real sync.
 */

import { afterEach, describe, expect, it } from "vitest";
import { parse, readStamp } from "../parser/index.js";
import { summaryFields } from "../host/present.js";
import { fences, guide } from "./guide.js";
import { newCollection } from "./collection.js";
import type { Collection } from "./collection.js";

const T0 = new Date("2026-09-22T12:00:00.000Z");
let open: Collection | null = null;

afterEach(async () => {
  await open?.close();
  open = null;
});

const firstSync = (): Promise<string> => guide("first-sync.md");

describe("the examples the guide shows a reader", () => {
  it("shows a stamped line that really is one", async () => {
    // The first thing the guide does is show what a stamp looks like. If that
    // example were wrong — a hyphen too few, the comment in the wrong place — a
    // reader would be looking for the wrong thing in their own notes.
    const [example] = fences(await firstSync(), "markdown");
    const line = example!.trim();
    expect(line).toContain("<!-- sr-");

    const stamp = readStamp(line);
    expect(stamp, "the guide's example line does not read as stamped").not.toBeNull();
    expect(stamp!.id).toMatch(/^sr-[A-Za-z0-9]{12}$/);

    const [card] = parse(line);
    expect(card).toMatchObject({ question: "Default Lambda timeout", answer: "3 seconds" });
    expect(card!.id).toBe(stamp!.id);
  });

  it("shows three shapes that are cards, and they all are", async () => {
    // The `## What counts as a card` block: a bare line, a list item, a task box.
    const blocks = fences(await firstSync(), "markdown");
    const shapes = blocks.find((b) => b.includes("Max memory"));
    expect(shapes, "the guide no longer shows the three card shapes").toBeDefined();

    const lines = shapes!.trim().split("\n");
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(parse(line), `the guide calls this a card: ${line}`).toHaveLength(1);
    }
    // And the list marker and task box are stripped from the question, so a card
    // does not arrive with `- [ ]` in it.
    expect(parse(lines.join("\n")).map((c) => c.question)).toEqual([
      "Default Lambda timeout",
      "Max memory",
      "Cold start cause",
    ]);
  });

  it("is right that `foo::bar` is not one", async () => {
    expect(await firstSync()).toContain("`foo::bar` is **not** a card");
    expect(parse("foo::bar")).toEqual([]);
  });

  it("is right about every context it says is skipped", async () => {
    // "fenced and indented code blocks, inline code spans, table rows, YAML
    // frontmatter, blockquotes, and headings" — six claims in one sentence, and a
    // false positive in any of them writes a stamp into someone's note.
    const sentence = await firstSync();
    for (const named of [
      "code blocks",
      "inline code spans",
      "table rows",
      "YAML frontmatter",
      "blockquotes",
      "headings",
    ]) {
      expect(sentence, `the guide no longer mentions ${named}`).toContain(named);
    }

    const note = [
      "---",
      "frontmatter :: not a card",
      "---",
      "# heading :: not a card",
      "> quoted :: not a card",
      "| table :: not a card | x |",
      "`inline :: not a card`",
      "```",
      "fenced :: not a card",
      "```",
      "    indented :: not a card",
      "",
      "real :: card",
    ].join("\n");
    expect(parse(note).map((c) => c.question)).toEqual(["real"]);
  });
});

describe("looking before it writes", () => {
  it("writes nothing on a dry run — not a stamp, not a database row", async () => {
    // The guide's exact promise, and the reason anyone trusts the preview.
    expect(await firstSync()).toContain("A preview writes nothing — not a stamp, not a database row");

    open = await newCollection();
    await open.write("a.md", "Q1 :: A1\nQ2 :: A2\n");
    await open.write("b.md", "# no cards here\n");
    const before = await open.read("a.md");

    const dry = await open.core.sync(T0, { dryRun: true });
    expect(dry.cardsFound).toBe(2);
    expect(await open.read("a.md")).toBe(before);
    expect(open.core.getDueCards(T0, 10)).toEqual([]);
    expect(open.core.stats(T0, 100).total).toBe(0);
  });

  it("reports the two numbers the guide tells a reader to compare", async () => {
    // "`1893 cards found` — lines GeodeMD read as cards" against "`96 files
    // stamped` — notes it would edit. This is the diff size." They differ because
    // one note can hold many cards, which is the whole point of showing both.
    const text = await firstSync();
    expect(text).toContain("cards found");
    expect(text).toContain("files stamped");

    open = await newCollection();
    await open.write("many.md", "Q1 :: A1\nQ2 :: A2\nQ3 :: A3\n");
    await open.write("one.md", "Q4 :: A4\n");
    await open.write("none.md", "prose only\n");

    const dry = await open.core.sync(T0, { dryRun: true });
    expect(dry.cardsFound).toBe(4);
    expect(dry.filesStamped).toBe(2);
    expect(dry.filesEnumerated).toBe(3);

    // And both labels are ones the shared summary actually reports, so the guide's
    // sample output cannot drift from what a run prints.
    const labels = summaryFields(dry).map((f) => f.label);
    expect(labels).toContain("cards found");
    expect(labels).toContain("files stamped");
  });
});

describe("the real sync", () => {
  it("edits every file that contains a card, and only those", async () => {
    // The sentence the whole guide is built around.
    expect(await firstSync()).toContain("edits every file that contains a card");

    open = await newCollection();
    await open.write("cards.md", "Q1 :: A1\nQ2 :: A2\n");
    await open.write("prose.md", "nothing here parses\n");
    const proseBefore = await open.read("prose.md");

    const summary = await open.core.sync(T0);
    expect(summary.filesStamped).toBe(1);
    expect(summary.cardsNew).toBe(2);

    const cards = await open.read("cards.md");
    expect(cards.split("\n").filter((l) => l.includes("<!-- sr-"))).toHaveLength(2);
    expect(await open.read("prose.md")).toBe(proseBefore);
  });

  it("leaves a second run with nothing to do, so the edit happens once", async () => {
    open = await newCollection();
    await open.write("cards.md", "Q1 :: A1\n");
    await open.core.sync(T0);
    const stamped = await open.read("cards.md");

    const later = new Date(T0.getTime() + 60_000);
    const again = await open.core.sync(later);
    expect(again.filesStamped).toBe(0);
    expect(again.cardsNew).toBe(0);
    expect(await open.read("cards.md")).toBe(stamped);
  });
});
