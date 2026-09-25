/**
 * The journey `docs/guides/reviewing.md` describes, held to what it says.
 *
 * Every test here reads the guide and checks the claim it finds, rather than
 * restating the claim in TypeScript — which is the difference between a test that
 * documents behaviour and a document that stays true. A reader who follows the
 * guide's key table and finds `3` does something else has been misled by us, and
 * that is the failure this file exists to make impossible.
 *
 * It does not re-prove the mechanisms: `host/queue.test.ts` covers the queue and
 * `session.test.ts` covers the screen. What is here is the sequence a person
 * actually performs, and the sentences we printed for them.
 */

import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  ACTION_KEYS,
  RATING_KEYS,
  actionsAt,
  interpretAnnotatingKey,
  interpretKey,
  interpretViewingKey,
} from "../host/present.js";
import { detectEditors, editorCommand, launchCommand, resolveEditor } from "../host/editor.js";
import { cardLineNote, noteMarkdown } from "../host/note.js";
import { initConfig, readConfig, setEditor, setViewNotesInside } from "../host/config.js";
import type { Machine } from "../host/editor.js";
import { FsrsScheduler } from "../scheduler/index.js";
import { codeSpans, guide, plain, tableAfter } from "./guide.js";
import { newCollection } from "./collection.js";
import type { Collection } from "./collection.js";

const T0 = new Date("2026-09-22T12:00:00.000Z");
let open: Collection | null = null;

afterEach(async () => {
  await open?.close();
  open = null;
});

async function reviewing(): Promise<string> {
  return guide("reviewing.md");
}

describe("the guide's four ratings are the four the app honours", () => {
  it("names the same keys, in the same order, with the same words", async () => {
    const rows = tableAfter(await reviewing(), "## The four ratings");
    const fromGuide = rows.map((cells) => [plain(cells[0]!), plain(cells[1]!)]);
    expect(fromGuide).toEqual(RATING_KEYS.map(([key, label]) => [key, label]));
  });

  it("advertises no key that does nothing", async () => {
    // The escape-key bug in reverse: the guide says `Escape` quits, and it now
    // does — but a guide naming a key the code ignores is the same failure
    // wearing a friendlier face, and it would read as authoritative.
    const text = await reviewing();
    const keys = new Set(
      codeSpans(text).filter((s) => /^([0-9a-z]|Escape)$/.test(s)),
    );
    expect(keys.size).toBeGreaterThan(4);
    for (const key of keys) {
      // A key the review ignores may still be one the note viewer honours —
      // `e` is only ever pressed over a note.
      const honoured = interpretKey(key).kind !== "ignore" || interpretViewingKey(key).kind !== "ignore";
      expect(honoured, `the guide advertises \`${key}\``).toBe(true);
    }
  });

  it("puts `0` and `o` at the stages it says they are offered at", async () => {
    const text = await reviewing();
    // Stated as headings, so they are what a reader skims to.
    expect(text).toContain("## `0 later` — the key for \"not now\"");
    expect(text).toContain("Offered **only before you have seen the answer**");
    expect(text).toContain("## `o` — open the note");
    expect(text).toContain("Offered once the answer is showing");

    expect(actionsAt("question").map((a) => a.key)).toContain("0");
    expect(actionsAt("question").map((a) => a.key)).not.toContain("o");
    expect(actionsAt("answer").map((a) => a.key)).toContain("o");
    expect(actionsAt("answer").map((a) => a.key)).not.toContain("0");
    // And `q` at both, which the guide's "from the question or the answer" says.
    expect(ACTION_KEYS.find((a) => a.key === "q")?.stage).toBe("both");
  });

  it("offers the editors it says `o` can put on a line, and no terminal ones", async () => {
    const text = plain(await reviewing());
    expect(text).toContain("Choose an editor on the Vault screen if you want the line jump.");
    expect(text).toContain("Open notes in");

    // Every editor installed, so the list is everything the screen could offer.
    const everything: Machine = {
      env: { PATH: "/bin" },
      platform: "darwin",
      home: "/Users/me",
      isExecutable: (f) => f.startsWith("/bin/"),
    };
    const offered = detectEditors(everything);
    // "VS Code, Cursor, Zed, Sublime Text and their relatives" — each named
    // one is offered, and each offered one lands on the card.
    for (const named of ["Visual Studio Code", "Cursor", "Zed", "Sublime Text"]) {
      expect(offered.map((e) => e.label), named).toContain(named);
    }
    for (const { command } of offered) {
      expect(editorCommand(command, "/n/a.md", 142).args.join(" "), command).toContain("142");
    }
    // "That is why none are listed" — the terminal editor it names.
    expect(text).toContain("a terminal editor like vim starts in a window you cannot type into");
    expect(offered.map((e) => e.command)).not.toContain("vim");

    // "Other… takes a command … such as code -w", which still lands on the line.
    expect(text).toContain("Other… takes a command for anything not listed, such as code -w");
    const typed = launchCommand("code -w", "/n/a.md", 142, everything);
    expect(typed.ok && typed.args).toEqual(["-w", "--goto", "/n/a.md:142"]);

    // "o says it was not found rather than quietly opening the note at the top".
    expect(text).toContain("says it was not found rather than quietly opening the note at the top");
    const gone = launchCommand("cursor", "/n/a.md", 142, { ...everything, isExecutable: () => false });
    expect(gone.ok).toBe(false);
  });
});

describe("reading the note inside the app does what the guide says", () => {
  const HEADING = "### Reading the note without leaving the review";

  it("offers the three keys in its table, and they do what the table says", async () => {
    const rows = tableAfter(await reviewing(), HEADING).map((cells) => [plain(cells[0]!), plain(cells[1]!)]);
    expect(rows).toEqual([
      ["o", "back to the card"],
      ["Escape", "back to the card"],
      ["e", "open in editor"],
    ]);
    // The two that are buttons are labelled as the table words them.
    expect(actionsAt("note").map((a) => [a.key, a.label])).toEqual([rows[0], rows[2]]);
    expect(interpretViewingKey("o").kind).toBe("close");
    expect(interpretViewingKey("Escape").kind).toBe("close");
    expect(interpretViewingKey("e").kind).toBe("editor");
  });

  it("gives the review keys nothing to do while the note is showing", async () => {
    const text = plain(await reviewing());
    expect(text).toContain(
      "the review keys do nothing: 3 does not rate the card behind it, q does not quit, and a does not open the annotation",
    );
    for (const key of ["1", "2", "3", "4", "q", "a", "0"]) {
      expect(interpretViewingKey(key).kind, key).toBe("ignore");
    }
  });

  it("is a setting of its own, so `e` still opens the editor chosen under Open notes in", async () => {
    const text = plain(await reviewing());
    expect(text).toContain("Tick Read notes inside GeodeMD first on the Vault screen, under Open notes in");
    expect(text).toContain("e opens the note in the editor chosen under Open notes in");

    open = await newCollection();
    const file = path.join(path.dirname(open.dbPath), "config.json");
    await initConfig(file, open.notes, { dbPath: open.dbPath });
    await setEditor(file, "code");
    await setViewNotesInside(file, true);
    const config = await readConfig(file);
    expect(config?.viewNotesInside).toBe(true);
    // The editor is untouched, and it is what `e` hands the note to.
    expect(resolveEditor(config?.editor, {} as NodeJS.ProcessEnv)).toBe("code");
  });

  it("finds the card by its id when the note has changed, and says so rather than highlighting the wrong line", async () => {
    const text = plain(await reviewing());
    expect(text).toContain("the card is looked for by its id rather than its old line number");
    expect(text).toContain("if it is not in the note any more, nothing is highlighted and that line says why");

    open = await newCollection();
    await open.write("a.md", "Intro.\nQ1 :: A1\n");
    await open.core.sync(T0);
    const [card] = open.core.getDueCards(T0, 10);
    expect(card!.lineNo).toBe(2);

    // Moved: two lines added above it since the sync.
    await open.write("a.md", `New.\nLines.\n${await open.read("a.md")}`);
    const moved = await open.core.readNote(card!.filePath, card!.id);
    expect(moved.line).toBe(4);
    expect(cardLineNote(card!.lineNo, moved.line)).toContain("now on line 4");
    expect(noteMarkdown(moved.text, moved.line, "m").split("\n")[3]).toBe('<mark id="m">Q1 :: A1</mark>');

    // Gone: nothing is marked, and the viewer says why.
    await open.write("a.md", "Intro.\nRewritten.\n");
    const gone = await open.core.readNote(card!.filePath, card!.id);
    expect(gone.line).toBeNull();
    expect(noteMarkdown(gone.text, gone.line, "m")).not.toContain("<mark");
    expect(cardLineNote(card!.lineNo, gone.line)).toContain("nothing is highlighted");
  });
});

describe("the intervals the guide quotes are the ones FSRS produces", () => {
  it("matches every row of the table, against the real scheduler", async () => {
    // The row that matters most is `3` — ten minutes is why a card comes back
    // before the sitting ends, and the whole "A card usually comes back" section
    // is built on it. A ts-fsrs bump that changed these would fail here rather
        // than quietly making the guide wrong.
    const rows = tableAfter(await reviewing(), "## A card usually comes back in the same session");
    const scheduler = new FsrsScheduler();
    expect(rows).toHaveLength(4);

    for (const [keyCell, dueCell] of rows) {
      const key = plain(keyCell!).split(" ")[0]! as "1" | "2" | "3" | "4";
      const stated = plain(dueCell!);
      const next = scheduler.next(scheduler.initial(T0), Number(key) as 1 | 2 | 3 | 4, T0);
      const minutes = (new Date(next.due).getTime() - T0.getTime()) / 60_000;

      const [, n, unit] = /^(\d+)\s+(minute|minutes|day|days)/.exec(stated) ?? [];
      expect(n, `cannot read "${stated}" as an interval`).toBeDefined();
      const expected = unit!.startsWith("day") ? Number(n) * 1440 : Number(n);
      expect(minutes, `the guide says \`${key}\` gives ${stated}`).toBe(expected);
    }
  });

  it("is right that a long-standing card rated `1` comes back in five minutes", async () => {
    expect(await reviewing()).toContain("rated `1`, comes back in 5 minutes");
    const scheduler = new FsrsScheduler();
    const graduated = scheduler.next(scheduler.initial(T0), 4, T0);
    const reviewedAt = new Date(graduated.due);
    const lapsed = scheduler.next(graduated, 1, reviewedAt);
    expect((new Date(lapsed.due).getTime() - reviewedAt.getTime()) / 60_000).toBe(5);
  });
});

describe("a rating is safe the moment it is given", () => {
  it("is in the review log on disk, which is what the guide promises", async () => {
    // "Each one is written to the review log and flushed to disk before anything
    // else happens" — so a rating is checkable in a file, not only in a database.
    expect(await reviewing()).toContain("written to the review log and flushed to disk");

    open = await newCollection("laptop");
    await open.write("a.md", "Q1 :: A1\nQ2 :: A2\nQ3 :: A3\n");
    await open.core.sync(T0);

    const queue = open.core.getDueCards(T0, 10);
    await open.core.reviewCard(queue[0]!.id, 3, T0);
    await open.core.reviewCard(queue[1]!.id, 1, T0);

    const dir = path.join(open.notes, ".sr", "log");
    const shards = await fs.readdir(dir);
    expect(shards).toEqual(["laptop-2026-09.jsonl"]);

    const lines = (await fs.readFile(path.join(dir, shards[0]!), "utf8")).trim().split("\n");
    expect(lines.map((l) => JSON.parse(l) as { card: string; rating: number })).toEqual([
      { card: queue[0]!.id, at: T0.toISOString(), rating: 3 },
      { card: queue[1]!.id, at: T0.toISOString(), rating: 1 },
    ]);
  });

  it("survives quitting halfway, as the guide says it does", async () => {
    // "quitting, closing the window, a crash, or a dead battery costs you nothing
    // but the cards you had not answered yet."
    expect(await reviewing()).toContain("costs you nothing but the cards you had not answered yet");

    open = await newCollection();
    await open.write("a.md", "Q1 :: A1\nQ2 :: A2\nQ3 :: A3\n");
    await open.core.sync(T0);
    expect(open.core.stats(T0, 100).newCards).toBe(3);

    const queue = open.core.getDueCards(T0, 10);
    await open.core.reviewCard(queue[0]!.id, 3, T0);
    // …and the user quits here. Nothing else runs.
    await open.reopen();

    const after = open.core.stats(T0, 100);
    expect(after.newCards).toBe(2);
    expect(after.total).toBe(3);
  });
});

describe("the session's own claims about what you get", () => {
  it("serves due cards before new ones, most overdue first", async () => {
    // "Cards that are due, most overdue first, then cards never reviewed, in the
    // order they read in your notes. Nothing is randomised."
    const text = await reviewing();
    expect(text).toContain("most overdue first, then cards never reviewed");
    expect(text).toContain("Nothing is randomised");

    open = await newCollection();
    await open.write("a.md", "Q1 :: A1\nQ2 :: A2\n");
    await open.write("b.md", "Q3 :: A3\n");
    await open.core.sync(T0);

    const all = open.core.getDueCards(T0, 10);
    // Answer the second card so it becomes the only one with a schedule.
    await open.core.reviewCard(all[1]!.id, 1, T0);

    const later = new Date(T0.getTime() + 10 * 60_000);
    const queue = open.core.getDueCards(later, 10);
    expect(queue[0]!.id).toBe(all[1]!.id);
    expect(queue.slice(1).map((c) => c.question)).toEqual(["Q1", "Q3"]);
  });

  it("does not walk the notes, so a deleted card can still turn up", async () => {
    // "`review` deliberately does not walk your notes … so a note you deleted
    // since the last sync leaves its cards in the queue until you run `geode sync`."
    expect(await reviewing()).toContain("leaves its cards in the queue until you sync");

    open = await newCollection();
    await open.write("a.md", "Q1 :: A1\n");
    await open.write("b.md", "Q2 :: A2\n");
    await open.core.sync(T0);
    expect(open.core.getDueCards(T0, 10)).toHaveLength(2);

    await fs.rm(path.join(open.notes, "b.md"));
    expect(open.core.getDueCards(T0, 10)).toHaveLength(2);

    const later = new Date(T0.getTime() + 60_000);
    await open.core.sync(later);
    expect(open.core.getDueCards(later, 10).map((c) => c.question)).toEqual(["Q1"]);
  });
});

describe("annotations are where the guide says, and behave as it says", () => {
  it("offers `a` once the answer is showing and never before", async () => {
    const text = await reviewing();
    expect(text).toContain("## `a` — annotate the card");
    expect(text).toContain("at the question `a` does nothing");
    expect(actionsAt("answer").map((a) => a.key)).toContain("a");
    expect(actionsAt("question").map((a) => a.key)).not.toContain("a");
  });

  it("treats `3` and `q` as text while the box is open, and closes it on the two keys named", async () => {
    const text = plain(await reviewing());
    expect(text).toContain('3 is part of "3 seconds", not a rating, and q is a letter, not a quit');
    expect(text).toContain("Two keys close it, and both save: Escape, and ⌘↵ (Cmd+Enter)");
    expect(interpretAnnotatingKey("3", false).kind).toBe("type");
    expect(interpretAnnotatingKey("q", false).kind).toBe("type");
    expect(interpretAnnotatingKey("Escape", false).kind).toBe("close");
    expect(interpretAnnotatingKey("Enter", true).kind).toBe("close");
  });

  it("keeps each one as a plain file in the notes folder, named by the card's id", async () => {
    const text = await reviewing();
    expect(text).toContain("one per card: `.sr/annotations/<card-id>.md`");
    expect(text).toContain("Emptying the box and closing it removes the annotation.");

    open = await newCollection();
    await open.write("a.md", "Q1 :: A1\n");
    await open.core.sync(T0);
    const [card] = open.core.getDueCards(T0, 10);
    await open.core.setAnnotation(card!.id, "mnemonic :: not a card\n");

    const file = path.join(open.notes, ".sr", "annotations", `${card!.id}.md`);
    expect(await fs.readFile(file, "utf8")).toBe("mnemonic :: not a card\n");
    // It is in the notes folder but never read as a note.
    const again = await open.core.sync(T0, { full: true });
    expect(again.filesEnumerated).toBe(1);
    expect(again.cardsFound).toBe(1);

    await open.core.setAnnotation(card!.id, "");
    await expect(fs.access(file)).rejects.toThrow();
  });

  it("keeps a deleted card's annotation, which comes back with the card", async () => {
    expect(plain(await reviewing())).toContain(
      "if the card comes back — restored from a backup, or the line undone — its annotation comes back with it",
    );

    open = await newCollection();
    await open.write("a.md", "Q1 :: A1\n");
    await open.core.sync(T0);
    const stamped = await open.read("a.md");
    const [card] = open.core.getDueCards(T0, 10);
    await open.core.setAnnotation(card!.id, "source: chapter 3\n");

    await open.write("a.md", "");
    await open.core.sync(T0);
    expect(open.core.getDueCards(T0, 10)).toHaveLength(0);
    expect(await open.core.getAnnotation(card!.id)).toBe("source: chapter 3\n");

    await open.write("a.md", stamped);
    await open.core.sync(T0);
    expect(open.core.getDueCards(T0, 10)[0]!.id).toBe(card!.id);
    expect(await open.core.getAnnotation(card!.id)).toBe("source: chapter 3\n");
  });
});
