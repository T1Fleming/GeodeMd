/**
 * Taking GeodeMD's stamps back out of a vault's notes (ADR 0035). The property
 * that matters: sync a folder, erase, and every note is byte for byte what it
 * was before GeodeMD saw it.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Core, unstampNotes } from "./index.js";
import { Store } from "../store/index.js";

const DEMO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "demo");
const MTIME = new Date("2026-09-01T00:00:00.000Z");
const T0 = new Date("2026-09-02T12:00:00.000Z");

let dir: string;
let notes: string;
let store: Store;
let core: Core;
let ids = 0;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "geode-erase-"));
  notes = path.join(dir, "notes");
  await fs.mkdir(notes, { recursive: true });
  store = new Store(":memory:");
  ids = 0;
  core = new Core(
    { notesPath: notes, device: "laptop-aaaa", dbPath: ":memory:", newId: () => `sr-${String(++ids).padStart(12, "0")}` },
    store,
  );
});

afterEach(async () => {
  store.close();
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(notes, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  await fs.utimes(abs, MTIME, MTIME);
}

const read = (rel: string) => fs.readFile(path.join(notes, rel), "utf8");

/** Every Markdown file under `root`, relative path to contents. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(rel: string): Promise<void> {
    for (const e of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory() && !e.name.startsWith(".")) await walk(r);
      else if (e.isFile() && e.name.endsWith(".md")) out[r] = await fs.readFile(path.join(root, r), "utf8");
    }
  }
  await walk("");
  return out;
}

describe("erasing GeodeMD's stamps from a vault", () => {
  it("leaves the demo notes byte for byte as they were before a sync", async () => {
    await fs.cp(DEMO, notes, { recursive: true });
    const before = await snapshot(notes);
    await core.sync(T0);
    expect(Object.values(await snapshot(notes)).join("")).toContain("<!-- sr-");

    const done = await unstampNotes(notes);
    expect(done.stamps).toBe(23);
    expect(done.changedUnderneath).toEqual([]);
    expect(await snapshot(notes)).toEqual(before);
  });

  it("finds stamps sync no longer reads: old `::` lines, code and conflict copies", async () => {
    await write("a.md", "Old :: card <!-- sr-a7Kd9mQ2xR4v -->\n```\nx >> y <!-- sr-Zz9Yy8Xx7Ww6 -->\n```\n");
    await write("a.sync-conflict-20260901-120000-ABCDEFG.md", "Q >> A <!-- sr-a7Kd9mQ2xR4v -->\n");
    const done = await unstampNotes(notes);
    expect(done).toMatchObject({ files: 2, stamps: 3 });
    expect(await read("a.md")).toBe("Old :: card\n```\nx >> y\n```\n");
    expect(await read("a.sync-conflict-20260901-120000-ABCDEFG.md")).toBe("Q >> A\n");
  });

  it("writes nothing on a dry run, and says what it would take out", async () => {
    await write("a.md", "Q >> A\n");
    await core.sync(T0);
    const stamped = await read("a.md");
    expect(await unstampNotes(notes, { dryRun: true })).toMatchObject({ files: 1, stamps: 1 });
    expect(await read("a.md")).toBe(stamped);
  });

  it("leaves a note with no stamp untouched, mtime included", async () => {
    await write("plain.md", "just prose\n");
    const st = await fs.stat(path.join(notes, "plain.md"));
    expect(await unstampNotes(notes)).toMatchObject({ files: 0, stamps: 0 });
    expect((await fs.stat(path.join(notes, "plain.md"))).mtimeMs).toBe(st.mtimeMs);
  });
});
