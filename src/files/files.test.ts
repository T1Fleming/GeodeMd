import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  appendLog,
  enumerate,
  listShards,
  readShardFrom,
  shardName,
  statFile,
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

describe("enumerate", () => {
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
});

describe("writeIfUnchanged", () => {
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

describe("readShardFrom", () => {
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
