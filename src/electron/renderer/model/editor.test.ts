import { describe, expect, it } from "vitest";
import { OTHER, SYSTEM_DEFAULT, editorView, onChoose } from "./editor.js";

const detected = [
  { command: "code", label: "Visual Studio Code" },
  { command: "zed", label: "Zed" },
];

describe("the editor setting on the Collection screen", () => {
  it("offers the system default, what is installed, and a typed command, in that order", () => {
    const v = editorView({ detected, current: null });
    expect(v.options.map((o) => o.label)).toEqual([
      "System default",
      "Visual Studio Code",
      "Zed",
      "Other…",
    ]);
  });

  it("shows the system default when no editor is set", () => {
    expect(editorView({ detected, current: null }).selected).toBe(SYSTEM_DEFAULT);
  });

  it("shows an installed editor as itself", () => {
    expect(editorView({ detected, current: "zed" })).toMatchObject({ selected: "zed", other: "" });
  });

  it("shows an editor that is not installed as a typed command, not as the default", () => {
    // Showing "System default" would misstate what `o` does; dropping the
    // value would lose it on the next save.
    expect(editorView({ detected, current: "cursor" })).toMatchObject({
      selected: OTHER,
      other: "cursor",
    });
    expect(editorView({ detected: [], current: "code -w" })).toMatchObject({
      selected: OTHER,
      other: "code -w",
    });
  });

  it("saves a choice at once, except a typed command, which waits to be typed", () => {
    expect(onChoose(SYSTEM_DEFAULT)).toBeNull();
    expect(onChoose("code")).toBe("code");
    expect(onChoose(OTHER)).toBeUndefined();
  });
});
