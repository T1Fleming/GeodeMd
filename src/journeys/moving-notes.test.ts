/**
 * The journey `docs/guides/moving-notes.md` describes, held to what it says.
 *
 * This guide makes an unusually bold promise — "everything two machines need in
 * order to agree is already in the files — which is a claim with tests behind it,
 * not a hope" — and then lists five of them. That sentence is only honest if the
 * tests exist and are findable, so these are them, one per bullet where the bullet
 * is checkable at this level.
 */

import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isSyncConflict } from "../files/index.js";
import { summaryFields } from "../host/present.js";
import { codeSpans, guide, paragraphWith } from "./guide.js";
import { newCollection } from "./collection.js";
import type { Collection } from "./collection.js";

const T0 = new Date("2026-09-22T12:00:00.000Z");
let open: Collection | null = null;

afterEach(async () => {
  await open?.close();
  open = null;
});

const moving = (): Promise<string> => guide("moving-notes.md");

describe("what the guide says two machines need in order to agree", () => {
  it("gives each machine its own log file, so none is ever merged", async () => {
    expect(await moving()).toContain("each machine writes its own review log file");

    open = await newCollection("desktop");
    await open.write("a.md", "Q1 :: A1\nQ2 :: A2\n");
    await open.core.sync(T0);
    const queue = open.core.getDueCards(T0, 10);
    await open.core.reviewCard(queue[0]!.id, 3, T0);

    // The same notes directory, reviewed from a second device.
    const second = await newCollection("laptop");
    try {
      await fs.rm(second.notes, { recursive: true });
      await fs.cp(open.notes, second.notes, { recursive: true });
      await second.core.sync(T0);
      const theirs = second.core.getDueCards(T0, 10);
      await second.core.reviewCard(theirs[0]!.id, 2, T0);

      const shards = (await fs.readdir(path.join(second.notes, ".sr", "log"))).sort();
      expect(shards).toEqual(["desktop-2026-09.jsonl", "laptop-2026-09.jsonl"]);
    } finally {
      await second.close();
    }
  });

  it("makes re-reading a log you already have a no-op, so a syncer may deliver it twice", async () => {
    expect(await moving()).toContain("re-reading a log you already have is a no-op");

    open = await newCollection();
    await open.write("a.md", "Q1 :: A1\n");
    await open.core.sync(T0);
    await open.core.reviewCard(open.core.getDueCards(T0, 1)[0]!.id, 3, T0);

    const first = await open.core.ingestLogs(T0);
    const second = await open.core.ingestLogs(T0);
    expect(second.reviewsIngested).toBe(0);
    expect(second.bytesRead).toBe(0);
    expect(first.reviewsIngested + second.reviewsIngested).toBeLessThanOrEqual(1);
  });

  it("lets a machine that has never seen the collection catch up from the files alone", async () => {
    expect(await moving()).toContain(
      "a machine that has never seen the collection catches up completely",
    );

    open = await newCollection("desktop");
    await open.write("a.md", "Q1 :: A1\nQ2 :: A2\n");
    await open.core.sync(T0);
    const queue = open.core.getDueCards(T0, 10);
    await open.core.reviewCard(queue[0]!.id, 3, T0);
    const established = open.core.stats(T0, 100);

    // A brand-new machine: no database at all, just the directory it was handed.
    const fresh = await newCollection("laptop");
    try {
      await fs.rm(fresh.notes, { recursive: true });
      await fs.cp(open.notes, fresh.notes, { recursive: true });

      const summary = await fresh.core.sync(T0);
      expect(summary.filesStamped).toBe(0); // nothing to stamp: the ids arrived
      expect(summary.reviewsIngested).toBe(1);
      expect(fresh.core.stats(T0, 100)).toEqual(established);
      expect(fresh.core.getDueCards(T0, 10).map((c) => c.id)).toEqual(
        open.core.getDueCards(T0, 10).map((c) => c.id),
      );
    } finally {
      await fresh.close();
    }
  });
});

describe("the conflict copies the guide promises to leave alone", () => {
  it("recognises both shapes it names, and neither shape it says it will not", async () => {
    // Four filenames, read straight out of the paragraph that names them, because
    // this is the one place the guide commits to specific strings — and two of the
    // four are promises NOT to act, which are the easier ones to break silently.
    const para = paragraphWith(await moving(), "It recognises Syncthing's");
    const named = codeSpans(para).filter((s) => s.endsWith(".md") || s.includes("conflicted copy"));
    expect(named.length).toBeGreaterThanOrEqual(3);

    for (const name of named) {
      const file = name.includes("conflicted copy") ? `note ${name}.md` : name;
      const recognised = isSyncConflict(path.basename(file));
      if (/sync-conflict|conflicted copy/.test(name)) {
        expect(recognised, `the guide says this is recognised: ${file}`).toBe(true);
      } else {
        expect(recognised, `the guide says this is NOT recognised: ${file}`).toBe(false);
      }
    }
  });

  it("leaves one alone in a real sync, and says that it did", async () => {
    open = await newCollection();
    await open.write("a.md", "Q1 :: A1\n");
    await open.core.sync(T0);
    const stamped = await open.read("a.md");

    // A syncer drops a conflict copy next to it — a byte copy, stamps included.
    const later = new Date(T0.getTime() + 60_000);
    await open.write("a.sync-conflict-20260922-120000-ABCDEFG.md", stamped);
    const summary = await open.core.sync(later);

    expect(summary.filesSyncConflict).toBe(1);
    expect(summary.cardsNew).toBe(0);
    // Untouched: "Nothing about it has been changed."
    expect(await open.read("a.sync-conflict-20260922-120000-ABCDEFG.md")).toBe(stamped);

    // And the run reports it in the words the guide's sample output uses.
    const label = summaryFields(summary).find((f) => f.key === "filesSyncConflict")?.label;
    expect(label).toBeDefined();
    const sample = await moving();
    expect(sample).toContain(label!);
  });
});
