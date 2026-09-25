import { describe, expect, it } from "vitest";
import { ADD, cannotRemove, choose, leftNote, switcherOptions } from "./vaults.js";
import type { VaultList } from "../../ipc.js";

const list: VaultList = {
  active: "home0001",
  vaults: [
    { id: "home0001", name: "Personal", notesPath: "/home/notes", dbPath: "/d/db.sqlite" },
    { id: "work0001", name: "Work", notesPath: "/work", dbPath: "/d/vaults/work0001/db.sqlite" },
  ],
};

describe("the vault switcher", () => {
  it("lists every vault by name, then a way to add one", () => {
    expect(switcherOptions(list).map((o) => o.label)).toEqual(["Personal", "Work", "Add vault…"]);
  });

  it("switches straight to a vault already added — there is nothing to preview", () => {
    expect(choose(list, "work0001")).toEqual({ kind: "switch", id: "work0001" });
  });

  it("sends adding one into the setup sequence instead", () => {
    expect(choose(list, ADD)).toEqual({ kind: "add" });
  });

  it("does nothing when the open vault is chosen again, or an unknown one", () => {
    expect(choose(list, "home0001")).toEqual({ kind: "none" });
    expect(choose(list, "gone0001")).toEqual({ kind: "none" });
  });
});

describe("removing a vault from the list", () => {
  it("is not offered for the open vault, and says why", () => {
    expect(cannotRemove(list, "home0001")).toContain("Switch to another");
    expect(cannotRemove(list, "work0001")).toBeNull();
  });
});

describe("notes edited in the vault just left", () => {
  it("names the vault, since its notes are no longer the ones on screen", () => {
    expect(leftNote({ vault: "work0001", changed: ["a.md", "b.md"] }, list)).toBe(
      "2 notes you opened in “Work” changed — sync that vault to pick them up.",
    );
    expect(leftNote({ vault: "work0001", changed: ["a.md"] }, list)).toContain("1 note you opened");
  });

  it("says nothing when nothing changed, or nothing was open", () => {
    expect(leftNote({ vault: "work0001", changed: [] }, list)).toBeNull();
    expect(leftNote(null, list)).toBeNull();
  });
});
