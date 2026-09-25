/**
 * `note/read` against a real vault in a temp directory — real config, real
 * sync, real stamps. `note.ts` imports nothing from Electron for this.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { addVault, chooseVault, initConfig } from "../../host/config.js";
import { Active } from "./active.js";
import { readNote, withinNotes } from "./note.js";

const T0 = new Date("2026-09-02T12:00:00.000Z");
const MTIME = new Date("2026-09-01T00:00:00.000Z");

let root: string;
let notes: string;
let configFile: string;
let active: Active;
let homeId: string;
let otherId: string;

/** A note, backdated out of the sync's two-second deferral window. */
async function write(rel: string, body: string, dir = notes): Promise<void> {
  const abs = path.join(dir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body, "utf8");
  await fs.utimes(abs, MTIME, MTIME);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "geode-note-"));
  notes = path.join(root, "notes");
  configFile = path.join(root, "config", "config.json");
  await write("algo/sort.md", "# Sorting\n\nQuicksort :: O(n log n)\nMergesort :: stable\n");
  // Outside the notes folder, and beside it with a name the folder's is a prefix of.
  await write("secret.md", "not yours\n", root);
  await write("x.md", "not yours either\n", path.join(root, "notes-evil"));
  await write("w.md", "W :: one\n", path.join(root, "other"));

  const env = { XDG_DATA_HOME: path.join(root, "data") } as NodeJS.ProcessEnv;
  homeId = (await initConfig(configFile, notes, { dbPath: path.join(root, "data", "home.sqlite"), env })).id;
  otherId = (await addVault(configFile, path.join(root, "other"), { env })).id;
  await chooseVault(configFile, homeId);
  active = new Active({ configFile, emit: () => undefined, finish: () => undefined, now: () => T0 });
  await (await active.ensure()).core.sync(T0);
});
afterEach(async () => {
  active.reset();
  await fs.rm(root, { recursive: true, force: true });
});

async function card(question: string): Promise<{ id: string; filePath: string; lineNo: number | null }> {
  const due = await (await active.ensure()).core.getDueCards(T0, 10);
  return due.find((c) => c.question === question)!;
}

describe("reading a card's note for the viewer", () => {
  it("returns the note as it is on disk, and the card's line in it", async () => {
    const c = await card("Mergesort");
    const r = await readNote(await active.ensureVault(homeId), c.filePath, c.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.text).toContain("# Sorting");
    expect(r.value.text).toContain(c.id); // the stamp is still in the text; the viewer strips it
    expect(r.value.line).toBe(4);
    expect(r.value.line).toBe(c.lineNo);
  });

  it("finds the card by its stamp when the note has been edited since the sync", async () => {
    const c = await card("Mergesort");
    const abs = path.join(notes, c.filePath);
    const text = await fs.readFile(abs, "utf8");
    await fs.writeFile(abs, `New first line.\n\n${text}`);
    const r = await readNote(await active.ensureVault(homeId), c.filePath, c.id);
    expect(r.ok && r.value.line).toBe(6);
  });

  it("has no line for a card that is no longer in the note, rather than a wrong one", async () => {
    const c = await card("Mergesort");
    await fs.writeFile(path.join(notes, c.filePath), "# Sorting\n\nRewritten entirely.\nAnd more.\n");
    const r = await readNote(await active.ensureVault(homeId), c.filePath, c.id);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.line).toBeNull();
  });

  it("says the note has gone, as a result rather than a throw", async () => {
    const c = await card("Mergesort");
    await fs.rm(path.join(notes, c.filePath));
    const r = await readNote(await active.ensureVault(homeId), c.filePath, c.id);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.message).toContain("sync");
  });
});

describe("a note read is confined to the notes folder", () => {
  it("refuses a stored `..`, however it is spelled", async () => {
    const open = await active.ensureVault(homeId);
    for (const bad of ["../secret.md", "algo/../../secret.md", "../notes-evil/x.md", path.join(root, "secret.md")]) {
      const r = await readNote(open, bad, "sr-aaaaaaaaaaaa");
      expect(r.ok, bad).toBe(false);
      expect(r.ok ? "" : r.message, bad).toContain("outside your notes folder");
    }
  });

  it("resolves before it checks, so a path that only wanders inside is fine", () => {
    expect(withinNotes(notes, "algo/../algo/sort.md")).toBe(path.join(notes, "algo", "sort.md"));
    expect(withinNotes(notes, ".")).toBeNull();
    expect(withinNotes(notes, "")).toBeNull();
  });

  it("is refused for a vault that is no longer open", async () => {
    // The review names the vault it was drawn from; after a switch, a note of
    // the same name in the other folder is not the one it asked for.
    await active.change(() => chooseVault(configFile, otherId));
    await expect(active.ensureVault(homeId)).rejects.toThrow(/no longer open/);
  });
});
