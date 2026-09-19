import { describe, expect, it } from "vitest";
import { editorCommand, resolveEditor } from "./editor.js";

const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;
const FILE = "/notes/algorithms/Sorting.md";

describe("resolveEditor", () => {
  it("prefers the config key, then VISUAL, then EDITOR", () => {
    const all = env({ VISUAL: "vis", EDITOR: "ed" });
    expect(resolveEditor("cfg", all)).toBe("cfg");
    expect(resolveEditor(undefined, all)).toBe("vis");
    expect(resolveEditor(undefined, env({ EDITOR: "ed" }))).toBe("ed");
  });

  it("is null when nothing names an editor", () => {
    // Not a failure — it selects the OS opener, which is how a .md reaches
    // whatever app owns it.
    expect(resolveEditor(undefined, env({}))).toBeNull();
    expect(resolveEditor("  ", env({ EDITOR: "  " }))).toBeNull();
  });
});

describe("editorCommand", () => {
  it("uses +LINE for the Unix family", () => {
    for (const name of ["vi", "vim", "nvim", "nano", "emacs"]) {
      expect(editorCommand(name, FILE, 142)).toEqual({ cmd: name, args: [`+142`, FILE] });
    }
  });

  it("uses --goto for the VS Code family", () => {
    expect(editorCommand("code", FILE, 142)).toEqual({
      cmd: "code",
      args: ["--goto", `${FILE}:142`],
    });
  });

  it("appends the line to the path for editors that read it there", () => {
    expect(editorCommand("hx", FILE, 142)).toEqual({ cmd: "hx", args: [`${FILE}:142`] });
    expect(editorCommand("subl", FILE, 142)).toEqual({ cmd: "subl", args: [`${FILE}:142`] });
  });

  it("carries the user's own flags through", () => {
    expect(editorCommand("code -w", FILE, 142)).toEqual({
      cmd: "code",
      args: ["-w", "--goto", `${FILE}:142`],
    });
  });

  it("recognises an editor named by its full path", () => {
    expect(editorCommand("/usr/local/bin/nvim", FILE, 7).args).toEqual(["+7", FILE]);
    expect(editorCommand("C:\\bin\\code.exe", FILE, 7).args).toEqual(["--goto", `${FILE}:7`]);
  });

  it("gives an unfamiliar editor the path and nothing else", () => {
    // Handing it `+142` risks creating a file with that name, which is worse
    // than landing on line 1.
    expect(editorCommand("myeditor", FILE, 142)).toEqual({ cmd: "myeditor", args: [FILE] });
  });

  it("omits the line when there is none to give", () => {
    for (const name of ["vim", "code", "hx", "myeditor"]) {
      expect(editorCommand(name, FILE, null).args).toEqual([FILE]);
    }
  });

  it("falls back to the platform opener when no editor is named", () => {
    expect(editorCommand(null, FILE, 142, "darwin")).toEqual({ cmd: "open", args: [FILE] });
    expect(editorCommand(null, FILE, 142, "linux")).toEqual({ cmd: "xdg-open", args: [FILE] });
    expect(editorCommand(null, FILE, 142, "win32")).toEqual({
      cmd: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", FILE],
    });
  });

  it("never routes a path through cmd.exe, which would re-parse it", () => {
    // `cmd /c start "" <file>` looks like the obvious opener and is not one:
    // Node quotes an argument only when it holds a space, tab, or quote, so a
    // note named `note&calc.md` arrives unquoted and `&` separates commands.
    const hostile = "C:\\notes\\note&calc.md";
    const { cmd, args } = editorCommand(null, hostile, null, "win32");
    expect(cmd).not.toBe("cmd");
    expect(args).toContain(hostile);
  });

  it("never passes a line to the OS opener, which cannot use one", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      expect(editorCommand(null, FILE, 142, platform).args.join(" ")).not.toContain("142");
    }
  });
});
