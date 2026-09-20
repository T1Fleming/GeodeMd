import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Core } from "./index.js";
import { ConfigError } from "./index.js";
import { Store } from "../store/index.js";

/**
 * Spec section 10: "Sync", "Incremental sync" and "Prune".
 * Against a temp directory and an in-memory SQLite.
 */

let notes: string;
let store: Store;
let core: Core;
let idCounter: number;

/** Predictable ids — section 6 rule 3 exists so these tests can be written. */
function nextId(): string {
  idCounter++;
  return `sr-${String(idCounter).padStart(12, "0")}`;
}

const T0 = new Date("2026-09-02T12:00:00.000Z");
/** Far from both T0 and the wall clock, so nothing lands in the defer window. */
const MTIME = new Date("2026-09-01T00:00:00.000Z");

beforeEach(async () => {
  notes = await fs.mkdtemp(path.join(os.tmpdir(), "geode-sync-"));
  store = new Store(":memory:");
  idCounter = 0;
  core = new Core({ notesPath: notes, device: "test", dbPath: ":memory:", newId: nextId }, store);
});

afterEach(async () => {
  store.close();
  await fs.rm(notes, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(notes, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  // Push mtime well away from every clock these tests use, so the 2s deferral
  // window does not swallow the file. Tests that exercise deferral set a fresh
  // mtime deliberately.
  await fs.utimes(abs, MTIME, MTIME);
}

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(notes, rel), "utf8");
}

describe("stamping", () => {
  it("mints an id, writes it to the note, and creates the card row", async () => {
    await write("a.md", "Default Lambda timeout :: 3 seconds\n");
    const s = await core.sync(T0);

    expect(s.cardsFound).toBe(1);
    expect(s.cardsNew).toBe(1);
    expect(await read("a.md")).toBe(
      "Default Lambda timeout :: 3 seconds <!-- sr-000000000001 -->\n",
    );
    const card = store.getCard("sr-000000000001")!;
    expect(card.file_path).toBe("a.md");
    expect(card.question).toBe("Default Lambda timeout");
    expect(card.line_no).toBe(1);
  });

  it("is idempotent across two runs", async () => {
    await write("a.md", "Q :: A\n");
    await core.sync(T0);
    const afterFirst = await read("a.md");

    const s = await core.sync(new Date(T0.getTime() + 60_000));
    expect(await read("a.md")).toBe(afterFirst);
    expect(s.cardsNew).toBe(0);
    expect(store.countCards()).toBe(1);
  });

  it("preserves a CRLF file byte-for-byte apart from the stamped line", async () => {
    const original = "intro\r\nQ :: A\r\ntail\r\n";
    await write("a.md", original);
    await core.sync(T0);

    const after = await read("a.md");
    expect(after).toBe("intro\r\nQ :: A <!-- sr-000000000001 -->\r\ntail\r\n");
    // Every other line keeps its CRLF; no whole-file conversion.
    expect(after.split("\r\n")).toHaveLength(original.split("\r\n").length);
  });

  it("preserves a missing final newline", async () => {
    await write("a.md", "Q :: A");
    await core.sync(T0);
    expect(await read("a.md")).toBe("Q :: A <!-- sr-000000000001 -->");
  });

  it("stamps every card in a file in one write", async () => {
    await write("a.md", "A :: 1\nB :: 2\nC :: 3\n");
    await core.sync(T0);
    const after = await read("a.md");
    expect(after).toBe(
      "A :: 1 <!-- sr-000000000001 -->\n" +
        "B :: 2 <!-- sr-000000000002 -->\n" +
        "C :: 3 <!-- sr-000000000003 -->\n",
    );
  });

  it("does not stamp inside a code block", async () => {
    await write("a.md", "```\nnot :: a card\n```\nreal :: card\n");
    await core.sync(T0);
    const after = await read("a.md");
    expect(after).toContain("not :: a card\n");
    expect(after).not.toMatch(/not :: a card <!--/);
    expect(store.countCards()).toBe(1);
  });
});

describe("the write guard", () => {
  it("mints nothing in a file whose mtime is inside the deferral window", async () => {
    const abs = path.join(notes, "a.md");
    await fs.writeFile(abs, "Q :: A\n", "utf8"); // mtime = now

    const s = await core.sync(new Date());
    expect(s.filesDeferred).toBe(1);
    expect(await read("a.md")).toBe("Q :: A\n");
    // Steps 4-5's invariant: nothing minted but unwritten may enter the DB.
    expect(store.countCards()).toBe(0);
  });

  it("syncs already-stamped cards in a deferred file", async () => {
    const abs = path.join(notes, "a.md");
    await fs.writeFile(abs, "Q :: A <!-- sr-aaaaaaaaaaaa -->\n", "utf8");

    const s = await core.sync(new Date());
    expect(s.filesDeferred).toBe(1);
    expect(store.getCard("sr-aaaaaaaaaaaa")).toBeDefined();
  });

  it("re-reads a deferred file on the next sync rather than calling it unchanged", async () => {
    // The bug this pins: recording the `files` row on a deferred pass makes the
    // next sync's fast path skip the file, so "waits for the next sync"
    // silently becomes "waits forever" and the card is never stamped.
    const abs = path.join(notes, "a.md");
    await fs.writeFile(abs, "Q :: A\n", "utf8");

    const first = await core.sync(new Date());
    expect(first.filesDeferred).toBe(1);

    const second = await core.sync(new Date());
    expect(second.filesUnchanged).toBe(0);
    expect(second.filesRead).toBe(1);
  });

  it("still records a deferred file that needed no minting", async () => {
    // Nothing was left undone, so the fast path may legitimately skip it later.
    const abs = path.join(notes, "a.md");
    await fs.writeFile(abs, "Q :: A <!-- sr-aaaaaaaaaaaa -->\n", "utf8");

    expect((await core.sync(new Date())).filesDeferred).toBe(1);
    expect((await core.sync(new Date())).filesUnchanged).toBe(1);
  });

  it("picks the deferred card up once the file goes quiet", async () => {
    const abs = path.join(notes, "a.md");
    await fs.writeFile(abs, "Q :: A\n", "utf8");
    await core.sync(new Date());
    expect(store.countCards()).toBe(0);

    const old = new Date(Date.now() - 60_000);
    await fs.utimes(abs, old, old);
    await core.sync(new Date());
    expect(store.countCards()).toBe(1);
    expect(await read("a.md")).toContain("<!-- sr-000000000001 -->");
  });
});

describe("identity across moves and copies", () => {
  it("a renamed file keeps the card id and its row follows the new path", async () => {
    await write("old.md", "Q :: A\n");
    await core.sync(T0);
    const id = "sr-000000000001";
    expect(store.getCard(id)!.file_path).toBe("old.md");

    await fs.rename(path.join(notes, "old.md"), path.join(notes, "new.md"));
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(path.join(notes, "new.md"), old, old);

    const s = await core.sync(new Date());
    expect(store.getCard(id)!.file_path).toBe("new.md");
    expect(store.countCards()).toBe(1);
    expect(s.reconciled).toBe(true); // old.md vanished
  });

  it("an edited question keeps the id and does not reset scheduling", async () => {
    await write("a.md", "Q :: A\n");
    await core.sync(T0);
    const id = "sr-000000000001";
    await core.reviewCard(id, 3, T0);
    const before = store.getState(id)!;

    await write("a.md", "Q edited :: A edited <!-- sr-000000000001 -->\n");
    const s = await core.sync(new Date(T0.getTime() + 60_000));

    expect(s.cardsUpdated).toBe(1);
    expect(store.getCard(id)!.question).toBe("Q edited");
    expect(store.getState(id)).toEqual(before); // a typo fix must not reset it
  });

  it("re-mints a duplicated stamped line and REPLACES its stamp", async () => {
    await write("a.md", "Q :: A <!-- sr-aaaaaaaaaaaa -->\nQ2 :: A2 <!-- sr-aaaaaaaaaaaa -->\n");
    const s = await core.sync(T0);

    expect(s.duplicatesReminted).toBe(1);
    const after = await read("a.md");
    // Section 4: never `<!-- old --> <!-- new -->`.
    expect(after).toBe(
      "Q :: A <!-- sr-aaaaaaaaaaaa -->\nQ2 :: A2 <!-- sr-000000000001 -->\n",
    );
    expect(store.countCards()).toBe(2);
    expect(store.getCard("sr-aaaaaaaaaaaa")!.question).toBe("Q"); // first occurrence kept it
  });

  it("skips a duplicate inside a DEFERRED file rather than overwriting the original", async () => {
    const abs = path.join(notes, "a.md");
    await fs.writeFile(abs, "Q :: A <!-- sr-aaaaaaaaaaaa -->\nCopy :: B <!-- sr-aaaaaaaaaaaa -->\n");

    await core.sync(new Date());
    // Its id IS on disk, but it belongs to the first occurrence; upserting
    // would overwrite that card's row with the copy's text.
    expect(store.getCard("sr-aaaaaaaaaaaa")!.question).toBe("Q");
    expect(store.countCards()).toBe(1);
  });

  it("re-mints a card COPIED into a second file", async () => {
    await write("a.md", "Q :: A\n");
    await core.sync(T0);
    const id = "sr-000000000001";

    // The same stamped line now exists in both files.
    await write("b.md", `Q :: A <!-- ${id} -->\n`);
    await core.sync(new Date());

    expect(store.getCard(id)!.file_path).toBe("a.md"); // original untouched
    expect(store.countCards()).toBe(2);
    expect(await read("b.md")).toContain("<!-- sr-000000000002 -->");
  });

  it("tells a copy from a move within ONE file, per card", async () => {
    // Step 5 now decides copy-versus-move in an async pre-pass over every card
    // in the file, before the transaction opens, because a transaction cannot
    // await. A file holding one of each is what catches a pre-pass that
    // over-skips, or that lets one card's outcome decide another's.
    await write("orig/keep.md", "Kept :: A\n");
    await write("orig/gone.md", "Moved :: B\n");
    await core.sync(T0);
    // By path, not by mint order — which file gets id 1 is the walk's business.
    const keptId = store.cardIdsInFile("orig/keep.md")[0]!;
    const movedId = store.cardIdsInFile("orig/gone.md")[0]!;
    expect(keptId).toBeTruthy();
    expect(movedId).toBeTruthy();

    // keep.md stays put and its line is ALSO copied into a new file — a copy.
    // gone.md is deleted, so its line in the new file is a move.
    await fs.rm(path.join(notes, "orig/gone.md"));
    await write("mixed.md", `Kept :: A <!-- ${keptId} -->\nMoved :: B <!-- ${movedId} -->\n`);
    await core.sync(new Date());

    expect(store.getCard(keptId)!.file_path).toBe("orig/keep.md"); // original untouched
    expect(store.getCard(movedId)!.file_path).toBe("mixed.md"); // move followed its card
    expect(store.countCards()).toBe(3); // original, its fresh copy, the moved one

    const mixed = await read("mixed.md");
    expect(mixed).toContain(`<!-- ${movedId} -->`); // move kept its stamp
    expect(mixed).not.toContain(`<!-- ${keptId} -->`); // copy was re-minted
  });

  it("keeps the id for a card MOVED to a second file", async () => {
    await write("a.md", "Q :: A\n");
    await core.sync(T0);
    const id = "sr-000000000001";

    await fs.rm(path.join(notes, "a.md"));
    await write("b.md", `Q :: A <!-- ${id} -->\n`);
    await core.sync(new Date());

    expect(store.getCard(id)!.file_path).toBe("b.md");
    expect(store.countCards()).toBe(1);
  });
});

describe("configuration errors versus skips", () => {
  it("throws on a missing notesPath rather than reporting a zero-card success", async () => {
    const bad = new Core(
      { notesPath: path.join(notes, "nope"), device: "t", dbPath: ":memory:", newId: nextId },
      store,
    );
    await expect(bad.sync(T0)).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws when notesPath is a file, not a directory", async () => {
    await write("a.md", "x");
    const bad = new Core(
      { notesPath: path.join(notes, "a.md"), device: "t", dbPath: ":memory:", newId: nextId },
      store,
    );
    await expect(bad.sync(T0)).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("incremental sync", () => {
  it("writes NOTHING when nothing changed", async () => {
    await write("a.md", "Q :: A\n");
    await core.sync(T0);

    const before = store.totalChanges();
    const s = await core.sync(new Date(T0.getTime() + 60_000));

    // The single most important assertion in section 10's harness.
    expect(store.totalChanges()).toBe(before);
    expect(s.filesUnchanged).toBe(1);
    expect(s.filesRead).toBe(0);
    expect(s.reconciled).toBe(false);
  });

  it("does not open an unchanged file, and does open a changed one", async () => {
    await write("a.md", "Q :: A\n");
    await write("b.md", "R :: B\n");
    await core.sync(T0);

    await write("b.md", "R :: B changed <!-- sr-000000000002 -->\n");
    const s = await core.sync(new Date());
    expect(s.filesRead).toBe(1);
    expect(s.filesUnchanged).toBe(1);
  });

  it("--full reads every file even when unchanged", async () => {
    await write("a.md", "Q :: A\n");
    await write("b.md", "R :: B\n");
    await core.sync(T0);

    const s = await core.sync(new Date(), { full: true });
    expect(s.filesRead).toBe(2);
    expect(s.filesUnchanged).toBe(0);
  });

  it("records the POST-write mtime so the next run sees no change", async () => {
    // Recording the pre-write values would make the file look changed forever.
    await write("a.md", "Q :: A\n");
    await core.sync(T0);

    const s = await core.sync(new Date(T0.getTime() + 60_000));
    expect(s.filesUnchanged).toBe(1);
    expect(s.filesRead).toBe(0);
  });

  it("loses exactly the cards deleted from a file", async () => {
    await write("a.md", "A :: 1\nB :: 2\n");
    await core.sync(T0);
    expect(store.countCards()).toBe(2);

    await write("a.md", "A :: 1 <!-- sr-000000000001 -->\n");
    await core.sync(new Date());

    expect(store.countCards()).toBe(1);
    expect(store.getCard("sr-000000000001")).toBeDefined();
    expect(store.getCard("sr-000000000002")).toBeUndefined();
  });

  it("triggers the reconciliation pass only when a file vanished", async () => {
    await write("a.md", "Q :: A\n");
    await write("b.md", "R :: B\n");
    await core.sync(T0);

    expect((await core.sync(new Date())).reconciled).toBe(false);

    await fs.rm(path.join(notes, "b.md"));
    expect((await core.sync(new Date())).reconciled).toBe(true);
  });
});

describe("progress reporting", () => {
  it("reports every enumerated file, including the ones the cache skips", async () => {
    // Per CANDIDATE, not per file read — a bar has to advance on a no-change
    // sync too, and it is a hot path precisely because it fires for cached
    // files.
    for (let i = 0; i < 5; i++) await write(`n${i}.md`, "Q :: A\n");
    await core.sync(T0);

    const seen: Array<[number, number, string]> = [];
    await core.sync(new Date(), { onProgress: (d, t, p) => seen.push([d, t, p]) });

    const scan = seen.filter(([, , p]) => p === "scan");
    expect(scan).toHaveLength(5);
    expect(scan.map(([d]) => d)).toEqual([1, 2, 3, 4, 5]);
    expect(scan.every(([, t]) => t === 5)).toBe(true);
  });

  it("moves through the phases in order", async () => {
    // Without this a bar sits pinned at the end of the file loop through prune
    // and ingest, which on a first ingest of a large log is the longest part of
    // the run.
    await write("a.md", "Q :: A\n");
    const phases: string[] = [];
    await core.sync(T0, { onProgress: (_d, _t, p) => phases.push(p) });

    expect(phases[0]).toBe("scan");
    expect(phases.lastIndexOf("scan")).toBeLessThan(phases.indexOf("prune"));
    expect(phases.indexOf("prune")).toBeLessThan(phases.indexOf("ingest"));
  });

  it("is optional — a caller that passes nothing is unaffected", async () => {
    await write("a.md", "Q :: A\n");
    await expect(core.sync(T0)).resolves.toBeTruthy();
  });
});

describe("filesStamped", () => {
  it("counts files edited, not cards — one file with many new cards is one", async () => {
    await write("many.md", "A :: 1\nB :: 2\nC :: 3\n");
    await write("one.md", "D :: 4\n");
    const s = await core.sync(T0);

    expect(s.cardsNew).toBe(4);
    expect(s.filesStamped).toBe(2);
  });

  it("is zero on a second sync, when nothing needs a stamp", async () => {
    await write("a.md", "Q :: A\n");
    await core.sync(T0);
    expect((await core.sync(new Date())).filesStamped).toBe(0);
  });

  it("does not count a file whose cards were all deferred", async () => {
    // A deferred file mints nothing, so nothing is stamped in it. Reporting it
    // would tell the user a note was edited when it was not.
    //
    // Written directly rather than through `write`, which backdates mtime to
    // keep files out of the deferral window on purpose.
    await fs.writeFile(path.join(notes, "fresh.md"), "Q :: A\n", "utf8"); // mtime = now
    const s = await core.sync(new Date());
    expect(s.filesDeferred).toBe(1);
    expect(s.filesStamped).toBe(0);
  });
});

describe("--dry-run", () => {
  it("reports how many files it WOULD edit, having edited none", async () => {
    // The point of the flag: the first sync of an existing collection rewrites
    // every file holding a card, and this is the number that says how many.
    await write("a.md", "Q :: A\n");
    await write("b.md", "R :: B\n");
    const before = store.totalChanges();

    const s = await core.sync(T0, { dryRun: true });
    expect(s.filesStamped).toBe(2);
    expect(await read("a.md")).not.toContain("<!-- sr-");
    expect(store.totalChanges()).toBe(before);
  });

  it("writes neither a stamp nor a row, and still reports what would happen", async () => {
    await write("a.md", "Q :: A\n");
    const before = store.totalChanges();

    const s = await core.sync(T0, { dryRun: true });

    expect(await read("a.md")).toBe("Q :: A\n");
    expect(store.totalChanges()).toBe(before);
    expect(store.countCards()).toBe(0);
    expect(s.cardsFound).toBe(1);
    expect(s.cardsNew).toBe(1);
  });

  it("leaves the real sync free to do the work afterwards", async () => {
    await write("a.md", "Q :: A\n");
    await core.sync(T0, { dryRun: true });
    await core.sync(T0);
    expect(store.countCards()).toBe(1);
  });
});

describe("prune", () => {
  it("removes card rows but leaves reviews and card_state untouched", async () => {
    await write("a.md", "Q :: A\n");
    await core.sync(T0);
    const id = "sr-000000000001";
    await core.reviewCard(id, 3, T0);

    const state = store.getState(id)!;
    await fs.rm(path.join(notes, "a.md"));
    await core.sync(new Date());

    expect(store.getCard(id)).toBeUndefined();
    // Absence is not deletion: history and schedule survive.
    expect(store.countReviews()).toBe(1);
    expect(store.getState(id)).toEqual(state);
  });

  it("restores a card on its original schedule, NOT queued as new", async () => {
    await write("a.md", "Q :: A\n");
    await core.sync(T0);
    const id = "sr-000000000001";
    await core.reviewCard(id, 3, T0);
    const state = store.getState(id)!;
    const stamped = await read("a.md");

    await fs.rm(path.join(notes, "a.md"));
    await core.sync(new Date());
    expect(store.getCard(id)).toBeUndefined();

    // Restored from a backup a year later.
    await write("a.md", stamped);
    await core.sync(new Date());

    const card = store.getCard(id)!;
    expect(card.file_path).toBe("a.md");
    // The assertion that `reviewed` was restored from card_state, not defaulted.
    expect(card.reviewed).toBe(1);
    expect(store.getState(id)).toEqual(state);
    expect(store.countNew()).toBe(0);
  });
});
