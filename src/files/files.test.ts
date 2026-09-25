import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  appendLog,
  enumerate,
  hasAnnotation,
  isSyncConflict,
  listShards,
  NotACardId,
  readAnnotation,
  readShardFrom,
  shardName,
  statFile,
  writeAnnotation,
  writeIfUnchanged,
} from "./index.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "geode-files-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

describe("walking the notes tree", () => {
  it("returns .md files with paths relative to the root", async () => {
    await write("a.md", "x");
    await write("sub/b.md", "y");
    const { candidates } = await enumerate(root);
    expect(candidates.map((c) => c.relPath)).toEqual(["a.md", "sub/b.md"]);
  });

  it("is deterministic — entries are sorted", async () => {
    for (const n of ["z.md", "a.md", "m.md"]) await write(n, "x");
    const { candidates } = await enumerate(root);
    expect(candidates.map((c) => c.relPath)).toEqual(["a.md", "m.md", "z.md"]);
  });

  it("skips non-.md files", async () => {
    await write("a.md", "x");
    await write("b.txt", "x");
    await write("c.markdown", "x");
    const { candidates } = await enumerate(root);
    expect(candidates.map((c) => c.relPath)).toEqual(["a.md"]);
  });

  it("skips every dotted directory", async () => {
    await write("keep.md", "x");
    await write(".git/a.md", "x");
    await write(".sr/log/b.md", "x");
    await write(".obsidian/c.md", "x");
    const { candidates } = await enumerate(root);
    expect(candidates.map((c) => c.relPath)).toEqual(["keep.md"]);
  });

  it("does not descend into a symlinked directory, and counts it", async () => {
    await write("real/note.md", "Q :: A");
    await fs.symlink(path.join(root, "real"), path.join(root, "link"), "dir");
    const { candidates, symlinkedDirs } = await enumerate(root);
    expect(candidates.map((c) => c.relPath)).toEqual(["real/note.md"]);
    expect(symlinkedDirs).toBe(1);
  });

  it("does not follow a symlinked file either", async () => {
    await write("real.md", "Q :: A");
    await fs.symlink(path.join(root, "real.md"), path.join(root, "alias.md"));
    const { candidates } = await enumerate(root);
    expect(candidates.map((c) => c.relPath)).toEqual(["real.md"]);
  });

  it("reports mtime and size", async () => {
    await write("a.md", "hello");
    const { candidates } = await enumerate(root);
    expect(candidates[0]!.size).toBe(5);
    expect(candidates[0]!.mtimeMs).toBeGreaterThan(0);
  });

  it("interleaves files and subdirectories in sorted order, at every depth", async () => {
    // Walk order decides which copy of a duplicated id keeps its history, so a
    // file sorting after a directory must follow that directory's whole
    // subtree — more than one level down, which nothing else here covers.
    for (const p of ["a.md", "m/b.md", "m/n/c.md", "m/z.md", "n2/d.md", "z.md"]) {
      await write(p, "Q :: A");
    }
    const { candidates } = await enumerate(root);
    expect(candidates.map((c) => c.relPath)).toEqual([
      "a.md",
      "m/b.md",
      "m/n/c.md",
      "m/z.md",
      "n2/d.md",
      "z.md",
    ]);
  });

  it("gives every candidate its OWN stat, not a neighbour's", async () => {
    // Every other fixture here writes same-sized files, which would hide a stat
    // landing on the wrong candidate. These are all different lengths.
    const expected = new Map<string, number>();
    for (let d = 0; d < 3; d++) {
      for (let i = 0; i < 100; i++) {
        const rel = `d${d}/n${String(i).padStart(3, "0")}.md`;
        const body = "x".repeat(d * 100 + i + 1);
        await write(rel, body);
        expected.set(rel, body.length);
      }
    }
    const { candidates } = await enumerate(root);
    expect(candidates).toHaveLength(300);
    for (const c of candidates) expect(c.size).toBe(expected.get(c.relPath));
  });
});

describe("refusing to write over someone else's edit", () => {
  it("writes and returns the POST-write stat", async () => {
    await write("a.md", "old");
    const before = (await statFile(root, "a.md"))!;
    const after = await writeIfUnchanged(root, "a.md", "new content", before);

    expect(after).not.toBeNull();
    expect(await fs.readFile(path.join(root, "a.md"), "utf8")).toBe("new content");
    // Recording the pre-write values would make the file look changed forever.
    expect(after!.size).toBe("new content".length);
    const actual = (await statFile(root, "a.md"))!;
    expect(after).toEqual(actual);
  });

  it("refuses to write when size changed since the read", async () => {
    await write("a.md", "old");
    const stale = (await statFile(root, "a.md"))!;
    await write("a.md", "the user typed more");

    const result = await writeIfUnchanged(root, "a.md", "clobbered", stale);
    expect(result).toBeNull();
    expect(await fs.readFile(path.join(root, "a.md"), "utf8")).toBe("the user typed more");
  });

  it("refuses to write when mtime changed but size did not", async () => {
    // Section 8 step 4 compares size *as well as* mtime; this is the other half.
    await write("a.md", "abc");
    const stale = (await statFile(root, "a.md"))!;
    await write("a.md", "xyz");

    const current = (await statFile(root, "a.md"))!;
    expect(current.size).toBe(stale.size);
    const result = await writeIfUnchanged(root, "a.md", "clobbered", stale);
    if (current.mtimeMs !== stale.mtimeMs) {
      expect(result).toBeNull();
      expect(await fs.readFile(path.join(root, "a.md"), "utf8")).toBe("xyz");
    }
  });

  it("returns null when the file vanished", async () => {
    await write("a.md", "old");
    const stale = (await statFile(root, "a.md"))!;
    await fs.rm(path.join(root, "a.md"));
    expect(await writeIfUnchanged(root, "a.md", "x", stale)).toBeNull();
  });
});

describe("the review log", () => {
  it("names a shard by device and the month of the timestamp", () => {
    expect(shardName("mac-k3f9", "2026-09-02T18:41:07.324Z")).toBe("mac-k3f9-2026-09.jsonl");
  });

  it("puts a review either side of midnight into different shards", async () => {
    // Section 5a: the month boundary is decided by the `at` being written.
    await appendLog(root, "mac", {
      card: "sr-aaaaaaaaaaaa",
      at: "2026-09-30T23:59:59.998Z",
      rating: 3,
    });
    await appendLog(root, "mac", {
      card: "sr-aaaaaaaaaaaa",
      at: "2026-10-01T00:00:00.002Z",
      rating: 3,
    });
    const shards = await listShards(root);
    expect(shards.map((s) => s.name)).toEqual(["mac-2026-09.jsonl", "mac-2026-10.jsonl"]);
  });

  it("creates the log directory on first write", async () => {
    await appendLog(root, "mac", { card: "sr-aaaaaaaaaaaa", at: "2026-09-01T00:00:00.000Z", rating: 3 });
    expect(await listShards(root)).toHaveLength(1);
  });

  it("appends rather than truncating", async () => {
    for (const at of ["2026-09-01T00:00:00.000Z", "2026-09-01T00:00:01.000Z"]) {
      await appendLog(root, "mac", { card: "sr-aaaaaaaaaaaa", at, rating: 3 });
    }
    const { text } = await readShardFrom(root, "mac-2026-09.jsonl", 0);
    expect(text.trimEnd().split("\n")).toHaveLength(2);
  });

  it("omits elapsed and scheduled when they are not supplied", async () => {
    await appendLog(root, "mac", { card: "sr-aaaaaaaaaaaa", at: "2026-09-01T00:00:00.000Z", rating: 3 });
    const { text } = await readShardFrom(root, "mac-2026-09.jsonl", 0);
    // Writing 0 would be a fabrication the future optimizer reads as fact.
    expect(text).not.toContain("elapsed");
    expect(JSON.parse(text.trim())).toEqual({
      card: "sr-aaaaaaaaaaaa",
      at: "2026-09-01T00:00:00.000Z",
      rating: 3,
    });
  });

  it("treats an absent log directory as a first run, not an error", async () => {
    expect(await listShards(root)).toEqual([]);
  });

  it("lists any .jsonl whatever it is named, and ignores other files", async () => {
    await write(".sr/log/restored-backup.jsonl", "");
    await write(".sr/log/notes.txt", "");
    const shards = await listShards(root);
    expect(shards.map((s) => s.name)).toEqual(["restored-backup.jsonl"]);
  });
});

describe("reading a log shard from where it left off", () => {
  it("reads from an offset only", async () => {
    await write(".sr/log/a.jsonl", "one\ntwo\nthree\n");
    const { text, consumed } = await readShardFrom(root, "a.jsonl", 4);
    expect(text).toBe("two\nthree\n");
    expect(consumed).toBe(14);
  });

  it("stops at the last COMPLETE line and leaves the offset before a partial one", async () => {
    // Section 8 step 7 — the crash the log-write-first ordering exists to survive.
    await write(".sr/log/a.jsonl", "one\ntwo\npart");
    const { text, consumed } = await readShardFrom(root, "a.jsonl", 0);
    expect(text).toBe("one\ntwo\n");
    expect(consumed).toBe(8);

    // The partial line is completed by the next append; the following read
    // picks it up in full because the offset never advanced past it.
    await fs.appendFile(path.join(root, ".sr/log/a.jsonl"), "ial\n");
    const second = await readShardFrom(root, "a.jsonl", consumed);
    expect(second.text).toBe("partial\n");
  });

  it("returns nothing when there is no complete line at all", async () => {
    await write(".sr/log/a.jsonl", "incomplete");
    expect(await readShardFrom(root, "a.jsonl", 0)).toEqual({ text: "", consumed: 0 });
  });

  it("returns nothing when the offset is already at EOF", async () => {
    await write(".sr/log/a.jsonl", "one\n");
    expect(await readShardFrom(root, "a.jsonl", 4)).toEqual({ text: "", consumed: 4 });
  });
});

/**
 * Conflict-copy detection. The cost of a false negative is a duplicate of
 * every card in a note; the cost of a false positive is silently ignoring a
 * note someone meant to keep. Those are not symmetric, which is why the
 * patterns are narrow and the result is reported rather than skipped quietly.
 */
describe("recognising a syncer's conflict copy", () => {
  it("catches Syncthing's shape", () => {
    expect(isSyncConflict("aws/lambda.sync-conflict-20260101-120000-ABCDEFG.md")).toBe(true);
    expect(isSyncConflict("lambda.sync-conflict-20260101-120000-7k2x9qz.md")).toBe(true);
  });

  it("catches Dropbox and Nextcloud, with or without an owner's name", () => {
    expect(isSyncConflict("lambda (conflicted copy 2026-01-01).md")).toBe(true);
    expect(isSyncConflict("lambda (Eric's conflicted copy 2026-01-01).md")).toBe(true);
    expect(isSyncConflict("lambda (Conflicted Copy 2026-01-01 123456).md")).toBe(true);
  });

  it("leaves ordinary filenames alone, including the ambiguous ones", () => {
    // iCloud's `note 2.md` and Drive's `note (1).md` really are conflict
    // markers for those tools — and are also names thousands of people choose
    // on purpose. A pattern wide enough to catch them silently ignores notes
    // someone meant to keep, which is worse than the bug being fixed.
    for (const name of [
      "lambda.md",
      "lambda 2.md",
      "lambda (1).md",
      "lambda-DESKTOP-AB1CDE.md",
      "conflicted.md",
      "notes about conflict resolution.md",
      "sync-conflict.md",
    ]) {
      expect(isSyncConflict(name), name).toBe(false);
    }
  });

  it("judges the filename, not the folder it sits in", () => {
    // A directory that matches must not condemn the notes inside it.
    expect(isSyncConflict("lambda (conflicted copy 2026-01-01)/notes.md")).toBe(false);
    expect(isSyncConflict("archive/lambda (conflicted copy 2026-01-01).md")).toBe(true);
  });
});

/**
 * A card's annotation (ADR 0029): one file per card under `.sr/annotations/`,
 * which is the whole store — no database row stands behind it.
 */
describe("a card's annotation", () => {
  const ID = "sr-a7Kd9mQ2xR4v";
  const dir = (): string => path.join(root, ".sr", "annotations");

  it("is null for a card that has none, and reads back what was written", async () => {
    expect(await readAnnotation(root, ID)).toBeNull();
    expect(await hasAnnotation(root, ID)).toBe(false);

    await writeAnnotation(root, ID, "mnemonic: three seconds, like a short breath\n");
    expect(await readAnnotation(root, ID)).toBe("mnemonic: three seconds, like a short breath\n");
    expect(await hasAnnotation(root, ID)).toBe(true);
    expect(await fs.readdir(dir())).toEqual([`${ID}.md`]);
  });

  it("is replaced whole by a second write", async () => {
    await writeAnnotation(root, ID, "a long first version of the annotation\n");
    await writeAnnotation(root, ID, "short\n");
    expect(await readAnnotation(root, ID)).toBe("short\n");
  });

  it("is removed by empty or blank text rather than left as an empty file", async () => {
    for (const blank of ["", "  \n\t\n"]) {
      await writeAnnotation(root, ID, "something\n");
      await writeAnnotation(root, ID, blank);
      expect(await readAnnotation(root, ID), JSON.stringify(blank)).toBeNull();
      expect(await fs.readdir(dir())).toEqual([]);
    }
    // Removing one that was never there is not an error.
    await expect(writeAnnotation(root, "sr-000000000009", "")).resolves.toBeUndefined();
  });

  it("refuses an id that is not a stamp, before it becomes a path", async () => {
    for (const bad of ["../../etc/passwd", "sr-short", "sr-a7Kd9mQ2xR4v/../x", "a7Kd9mQ2xR4v", ""]) {
      await expect(writeAnnotation(root, bad, "x"), bad).rejects.toBeInstanceOf(NotACardId);
      await expect(readAnnotation(root, bad), bad).rejects.toBeInstanceOf(NotACardId);
      await expect(hasAnnotation(root, bad), bad).rejects.toBeInstanceOf(NotACardId);
    }
    // Nothing was created anywhere under the root on the way.
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("leaves no partial or temporary file behind, whether the write succeeds or fails", async () => {
    await writeAnnotation(root, ID, "first\n");
    await writeAnnotation(root, ID, "second\n");
    expect(await fs.readdir(dir())).toEqual([`${ID}.md`]);

    // A rename that cannot land — the target is a directory — must fail
    // loudly and take its temp file with it.
    const other = "sr-000000000002";
    await fs.mkdir(path.join(dir(), `${other}.md`));
    await expect(writeAnnotation(root, other, "never lands\n")).rejects.toThrow();
    expect((await fs.readdir(dir())).sort()).toEqual([`${ID}.md`, `${other}.md`].sort());
    expect(await readAnnotation(root, ID)).toBe("second\n");
  });

  it("comes back byte-identical, CRLF and missing final newline included", async () => {
    for (const text of ["line one\r\nline two\r\n", "no newline at the end", "ünïcödé — ok\n"]) {
      await writeAnnotation(root, ID, text);
      expect(await readAnnotation(root, ID)).toBe(text);
      expect(await fs.readFile(path.join(dir(), `${ID}.md`))).toEqual(Buffer.from(text, "utf8"));
    }
  });

  it("is never walked as a note, so a ` :: ` inside one is not a card", async () => {
    await write("a.md", "Q :: A\n");
    await writeAnnotation(root, ID, "compare :: the other card\n");
    const { candidates } = await enumerate(root);
    expect(candidates.map((c) => c.relPath)).toEqual(["a.md"]);
  });
});
