import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { findOverlap, overlapMessage } from "./vaults.js";

let dir: string;
const realpath = (p: string): Promise<string> => fs.realpath(p);

beforeEach(async () => {
  // Real, so a symlink under it resolves the way the app's check will.
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "geode-vaults-")));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function folder(rel: string): Promise<string> {
  const p = path.join(dir, rel);
  await fs.mkdir(p, { recursive: true });
  return p;
}

const vault = (id: string, notesPath: string) => ({ id, name: id, notesPath });

describe("refusing two vaults that share notes", () => {
  it("refuses a folder inside an existing vault", async () => {
    const work = vault("work", await folder("work"));
    const o = await findOverlap(await folder("work/projects"), [work], realpath);
    expect(o).toEqual({ vault: work, relation: "inside" });
  });

  it("refuses a folder that contains an existing vault", async () => {
    const work = vault("work", await folder("notes/work"));
    const o = await findOverlap(await folder("notes"), [work], realpath);
    expect(o).toEqual({ vault: work, relation: "contains" });
  });

  it("refuses the same folder twice", async () => {
    const work = vault("work", await folder("work"));
    expect((await findOverlap(work.notesPath, [work], realpath))?.relation).toBe("same");
  });

  it("sees through a symlink, which would otherwise get round the check", async () => {
    const work = vault("work", await folder("work"));
    const link = path.join(dir, "shortcut");
    await fs.symlink(work.notesPath, link);
    expect((await findOverlap(link, [work], realpath))?.relation).toBe("same");
    expect((await findOverlap(path.join(link, "sub"), [work], realpath))?.relation).toBe("inside");
  });

  it("allows two unrelated folders, including ones that merely share a prefix", async () => {
    const work = vault("work", await folder("notes"));
    expect(await findOverlap(await folder("home"), [work], realpath)).toBeNull();
    // `/x/notes2` is not inside `/x/notes`, however the strings compare.
    expect(await findOverlap(await folder("notes2"), [work], realpath)).toBeNull();
  });

  it("still counts a vault whose folder is missing, as an unplugged drive would be", async () => {
    // Plugging the drive back in brings its cards back; a vault added inside
    // that path meanwhile would then overlap it.
    const away = vault("away", path.join(dir, "Volumes", "usb", "notes"));
    const o = await findOverlap(path.join(away.notesPath, "sub"), [away], realpath);
    expect(o?.relation).toBe("inside");
  });

  it("does not count the vault being re-pointed against itself", async () => {
    const work = vault("work", await folder("work"));
    expect(await findOverlap(await folder("work/inner"), [work], realpath, "work")).toBeNull();
  });

  it("says which vault, and why that matters, in one sentence", async () => {
    const work = vault("work", await folder("work"));
    const o = (await findOverlap(await folder("work/sub"), [work], realpath))!;
    const said = overlapMessage(path.join(work.notesPath, "sub"), o);
    expect(said).toContain("is inside the vault “work”");
    expect(said).toContain("review history would split");
  });
});
