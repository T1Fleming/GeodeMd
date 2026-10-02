import { describe, expect, it } from "vitest";
import { ADD, afterRemoving, choose, eraseConfirmed, leftNote, switcherOptions } from "./vaults.js";
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
  it("says which vault opens next when the open one goes", () => {
    expect(afterRemoving(list, "home0001")).toContain("opens “Work” next");
  });

  it("says nothing for a vault that is not open", () => {
    expect(afterRemoving(list, "work0001")).toBeNull();
  });

  it("says setup comes back when the only vault goes", () => {
    const one: VaultList = { active: "home0001", vaults: [list.vaults[0]!] };
    expect(afterRemoving(one, "home0001")).toContain("first-run setup");
  });
});

describe("confirming an erase", () => {
  it("needs the vault's exact name, spaces at either end aside", () => {
    expect(eraseConfirmed("Personal", " Personal ")).toBe(true);
    expect(eraseConfirmed("Personal", "personal")).toBe(false);
    expect(eraseConfirmed("Personal", "")).toBe(false);
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
