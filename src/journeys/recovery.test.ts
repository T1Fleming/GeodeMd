/**
 * The journey `docs/guides/recovery.md` describes, held to what it says.
 *
 * That guide tells a frightened reader to delete a file. Everything it claims
 * about what is durable, where it lives, and what comes back has to be true, and
 * two of its claims are **paths** — the kind of detail that silently stops being
 * right and is the most quoted thing in the document.
 */

import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { LOG_DIR, shardName } from "../files/index.js";
import { guide, plain, tableAfter } from "./guide.js";
import { newCollection } from "./collection.js";
import type { Collection } from "./collection.js";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const T0 = new Date("2026-09-22T12:00:00.000Z");
let open: Collection | null = null;

afterEach(async () => {
  await open?.close();
  open = null;
});

const recovery = (): Promise<string> => guide("recovery.md");

describe("what the guide says is durable, and where it says it lives", () => {
  it("names the log path the code actually writes to", async () => {
    // `<notes>/.sr/log/<device>-YYYY-MM.jsonl`, quoted in the guide's table. A
    // reader copies this into a backup script, so it has to be the real shape.
    const rows = tableAfter(await recovery(), "## What is actually durable");
    const stated = rows.map((cells) => plain(cells[1]!)).find((c) => c.includes(".sr/log"));
    expect(stated, "the guide no longer names the log path").toBeDefined();

    const real = path.join(LOG_DIR, shardName("<device>", "2026-09-22T12:00:00.000Z"));
    expect(stated).toBe(`<notes>/${real.split(path.sep).join("/")}`.replace("2026-09", "YYYY-MM"));
  });

  it("names four things, and calls exactly one of them a cache", async () => {
    const rows = tableAfter(await recovery(), "## What is actually durable");
    expect(rows).toHaveLength(4);
    const verdicts = rows.map((cells) => plain(cells[2]!));
    expect(verdicts.filter((v) => v === "durable")).toHaveLength(3);
    expect(verdicts.filter((v) => v === "a cache")).toHaveLength(1);
  });

  it("writes a log line at the path it promised, for a real review", async () => {
    open = await newCollection("desktop");
    await open.write("a.md", "Q1 >> A1\n");
    await open.core.sync(T0);
    await open.core.reviewCard(open.core.getDueCards(T0, 1)[0]!.id, 3, T0);

    const promised = path.join(open.notes, ".sr", "log", "desktop-2026-09.jsonl");
    await expect(fs.stat(promised)).resolves.toBeDefined();
  });
});

describe("deleting the database", () => {
  it("loses nothing that a rebuild does not put back", async () => {
    // The sentence the guide opens with: "your notes and your review log are the
    // real data. The database is a cache, and you can delete it."
    expect(await recovery()).toContain("The database is a cache, and you can delete it");

    open = await newCollection();
    await open.write("a.md", "Q1 >> A1\nQ2 >> A2\nQ3 >> A3\n");
    await open.core.sync(T0);

    const queue = open.core.getDueCards(T0, 10);
    await open.core.reviewCard(queue[0]!.id, 3, T0);
    await open.core.reviewCard(queue[1]!.id, 1, T0);
    const before = open.core.stats(T0, 100);

    // Delete it the way a user would: the file, while nothing is running.
    await open.reopen();
    await fs.rm(open.dbPath);
    await fs.rm(`${open.dbPath}-wal`, { force: true });
    await fs.rm(`${open.dbPath}-shm`, { force: true });
    await open.reopen();
    expect(open.core.stats(T0, 100).total).toBe(0);

    const summary = await open.core.rebuild(T0);
    expect(summary.reviewsIngested).toBe(2);
    expect(open.core.stats(T0, 100)).toEqual(before);
    // The ids came back too — they were in the notes all along, which is the
    // reason any of this works.
    expect(open.core.getDueCards(T0, 10).map((c) => c.id)).toEqual(
      queue.filter((c) => c.id !== queue[0]!.id && c.id !== queue[1]!.id).map((c) => c.id),
    );
  });

  it("stamps nothing new on the way back, because the notes already carry the ids", async () => {
    // "A card authored while the database was gone still gets its id" is the
    // rebuild test's job; this is the other half — a rebuild of an unchanged
    // collection must not rewrite a single note.
    open = await newCollection();
    await open.write("a.md", "Q1 >> A1\n");
    await open.core.sync(T0);
    const stamped = await open.read("a.md");

    const summary = await open.core.rebuild(new Date(T0.getTime() + 60_000));
    expect(summary.filesStamped).toBe(0);
    expect(await open.read("a.md")).toBe(stamped);
  });
});

describe("what rebuilding does not fix", () => {
  it("leaves a deleted card out of the queue, but keeps its history", async () => {
    // The guide's closing claim, and the one most likely to be doubted: "Restore
    // the note a year later and the cards come back on their original schedule
    // rather than as new."
    const text = await recovery();
    expect(text).toContain("A card you deleted from your notes is gone from the queue");
    expect(text).toContain("comes back on its original schedule rather than as new");

    open = await newCollection();
    await open.write("a.md", "Q1 >> A1\n");
    await open.write("b.md", "Q2 >> A2\n");
    await open.core.sync(T0);

    // Both cards are reviewed, so "new" below means "has no history at all"
    // rather than "happens to be the other card".
    const queue = open.core.getDueCards(T0, 10);
    for (const card of queue) await open.core.reviewCard(card.id, 4, T0);
    const gone = queue.find((c) => c.filePath === "b.md")!;
    const stampedB = await open.read("b.md");

    const later = new Date(T0.getTime() + 60_000);
    await fs.rm(path.join(open.notes, "b.md"));
    await open.core.sync(later);
    expect(open.core.stats(later, 100).total).toBe(1);

    // A year later, the note comes back exactly as it was — stamp included.
    const muchLater = new Date(T0.getTime() + 365 * 86_400_000);
    await open.write("b.md", stampedB);
    await open.core.sync(muchLater);

    const back = open.core.getDueCards(muchLater, 10).find((c) => c.filePath === "b.md");
    expect(back?.id).toBe(gone.id);
    // On its original schedule, NOT queued as new: nothing here has no history.
    expect(open.core.stats(muchLater, 100)).toMatchObject({ total: 2, newCards: 0 });
  });

  it("warns in the same words the app's own dialog does", async () => {
    // There is no command to spell any more (ADR 0025), so the checkable thing is
    // that the sentence in the guide and the sentence in the confirmation dialog
    // agree. Two places telling a frightened user different things about an
    // irreversible, minutes-long operation is the drift worth catching.
    const dialog = await fs.readFile(
      path.join(SRC, "electron", "renderer", "Sync.tsx"),
      "utf8",
    );
    for (const claim of ["takes minutes", "cannot be stopped once started"]) {
      expect(await recovery(), `the guide no longer says it ${claim}`).toContain(claim);
      expect(dialog, `the app no longer says it ${claim}`).toContain(claim);
    }
  });
});

describe("starting a vault fresh", () => {
  it("makes every card new without editing a note, as the guide says", async () => {
    const text = await recovery();
    expect(text).toContain("**Card ids and annotations stay, and no note is edited.**");

    open = await newCollection();
    await open.write("a.md", "Q1 >> A1\nQ2 >> A2\n");
    await open.core.sync(T0);
    const [first] = open.core.getDueCards(T0, 1);
    await open.core.reviewCard(first!.id, 3, T0);
    const before = await open.read("a.md");

    const later = new Date(T0.getTime() + 86_400_000);
    await open.core.startFresh(later);
    expect(await open.read("a.md")).toBe(before);
    expect(open.core.stats(later, 100)).toMatchObject({ total: 2, newCards: 2 });
  });

  it("archives the history where the guide says, and is undone the way it says", async () => {
    expect(await recovery()).toContain("move the files in `.sr/archive/<time>/log/` back into `.sr/log/`, delete `.sr/reset.json`, and sync");

    open = await newCollection("desktop");
    await open.write("a.md", "Q1 >> A1\n");
    await open.core.sync(T0);
    await open.core.reviewCard(open.core.getDueCards(T0, 1)[0]!.id, 3, T0);
    const later = new Date(T0.getTime() + 86_400_000);
    await open.core.startFresh(later);

    const archived = path.join(open.notes, ".sr", "archive", later.toISOString().replace(/:/g, "-"), "log");
    const shards = await fs.readdir(archived);
    expect(shards).toEqual(["desktop-2026-09.jsonl"]);

    for (const name of shards) await fs.rename(path.join(archived, name), path.join(open.notes, ".sr", "log", name));
    await fs.rm(path.join(open.notes, ".sr", "reset.json"));
    await open.core.sync(later);
    expect(open.core.stats(later, 100)).toMatchObject({ newCards: 0 });
  });

  it("says in the guide what the app's own dialog says", async () => {
    const dialog = await fs.readFile(path.join(SRC, "electron", "renderer", "Sync.tsx"), "utf8");
    for (const claim of ["Every device that shares this folder starts fresh too", "no note is edited"]) {
      expect(await recovery(), `the guide no longer says ${claim}`).toContain(claim);
      expect(dialog, `the app no longer says ${claim}`).toContain(claim);
    }
  });
});
