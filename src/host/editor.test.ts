import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  OpenedNotes,
  detectEditors,
  editorCommand,
  launchCommand,
  locateExecutable,
  resolveEditor,
} from "./editor.js";
import type { Machine } from "./editor.js";

const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;
const FILE = "/notes/algorithms/Sorting.md";

describe("which program opens a note", () => {
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

/** A machine where exactly `installed` can be run. */
function machine(
  installed: string[],
  over: Partial<Omit<Machine, "isExecutable">> = {},
): Machine {
  const set = new Set(installed);
  return {
    env: env({ PATH: "/usr/bin:/bin" }),
    platform: "darwin",
    home: "/Users/me",
    isExecutable: (f) => set.has(f),
    ...over,
  };
}

const CODE_BUNDLE = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";

describe("finding an editor that is not on the app's PATH", () => {
  it("uses the command on PATH when it is there", () => {
    const m = machine(["/usr/local/bin/code", CODE_BUNDLE], {
      env: env({ PATH: "/usr/local/bin:/usr/bin" }),
    });
    expect(locateExecutable("code", m)).toBe("/usr/local/bin/code");
  });

  it("finds a Mac app's launcher inside its bundle when PATH has none", () => {
    // Finder hands an app /usr/bin:/bin:/usr/sbin:/sbin — which is the whole
    // reason this lookup exists.
    expect(locateExecutable("code", machine([CODE_BUNDLE]))).toBe(CODE_BUNDLE);
  });

  it("looks in ~/Applications as well", () => {
    const zed = "/Users/me/Applications/Zed.app/Contents/MacOS/cli";
    expect(locateExecutable("zed", machine([zed]))).toBe(zed);
  });

  it("does not look in app bundles off macOS", () => {
    expect(locateExecutable("code", machine([CODE_BUNDLE], { platform: "linux" }))).toBeNull();
  });

  it("checks a full path rather than searching for it", () => {
    expect(locateExecutable("/opt/ed/bin/ed", machine(["/opt/ed/bin/ed"]))).toBe("/opt/ed/bin/ed");
    expect(locateExecutable("/opt/ed/bin/ed", machine([]))).toBeNull();
  });

  it("is null when it is nowhere", () => {
    expect(locateExecutable("cursor", machine([]))).toBeNull();
  });
});

describe("listing the editors installed here", () => {
  it("lists what is installed, found on PATH or only in a bundle", () => {
    const m = machine(["/usr/bin/subl", CODE_BUNDLE]);
    expect(detectEditors(m).map((e) => e.command)).toEqual(["code", "subl"]);
  });

  it("stores a plain name, not the path it was found at", () => {
    // The path has spaces in it, and the editor value is split on whitespace.
    expect(detectEditors(machine([CODE_BUNDLE]))[0]).toEqual({
      command: "code",
      label: "Visual Studio Code",
    });
  });

  it("is empty when nothing is installed", () => {
    expect(detectEditors(machine([]))).toEqual([]);
  });

  it("never offers a terminal editor, which would start with no TTY to type into", () => {
    const everything = (f: string): boolean => f.startsWith("/usr/bin/");
    const offered = detectEditors({ ...machine([]), isExecutable: everything }).map(
      (e) => e.command,
    );
    expect(offered.length).toBeGreaterThan(0);
    for (const terminal of ["vi", "vim", "nvim", "nano", "emacs", "hx", "helix", "micro", "kak"]) {
      expect(offered).not.toContain(terminal);
    }
  });

  it("offers only editors that can be put on the card's line", () => {
    const everything = (f: string): boolean => f.startsWith("/usr/bin/");
    for (const { command } of detectEditors({ ...machine([]), isExecutable: everything })) {
      expect(editorCommand(command, FILE, 142).args.join(" "), command).toContain("142");
    }
  });
});

describe("what o runs", () => {
  it("runs the resolved file, with the line flag chosen by name", () => {
    expect(launchCommand("code", FILE, 142, machine([CODE_BUNDLE]))).toEqual({
      ok: true,
      cmd: CODE_BUNDLE,
      args: ["--goto", `${FILE}:142`],
    });
  });

  it("still lands on the line when the launcher has another name", () => {
    // Zed's launcher is `cli`, which on its own would get the path and nothing else.
    const zed = "/Applications/Zed.app/Contents/MacOS/cli";
    expect(launchCommand("zed", FILE, 142, machine([zed]))).toEqual({
      ok: true,
      cmd: zed,
      args: [`${FILE}:142`],
    });
  });

  it("keeps the extra words of a typed command", () => {
    expect(launchCommand("code -w", FILE, 7, machine([CODE_BUNDLE]))).toEqual({
      ok: true,
      cmd: CODE_BUNDLE,
      args: ["-w", "--goto", `${FILE}:7`],
    });
  });

  it("is an error, not the OS opener, when a named editor is not installed", () => {
    // Falling back would open the note at the top, and nothing would say why
    // the line jump had stopped working.
    const r = launchCommand("cursor", FILE, 142, machine([]));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.message).toContain("cursor");
  });

  it("uses the OS opener, unlooked-up, when no editor is named", () => {
    expect(launchCommand(null, FILE, 142, machine([]))).toEqual({
      ok: true,
      cmd: "open",
      args: [FILE],
    });
  });
});

describe("how an editor is told which line", () => {
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

/**
 * The mtime comparison both interfaces make at the end of a session. Real
 * files and real mtimes: the whole point is that it notices an edit made by a
 * program this one never sees.
 */
describe("noticing a note you edited while reviewing", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "geode-opened-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const write = async (rel: string, text: string): Promise<void> => {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), text);
  };

  /** mtime resolution is coarse enough that an immediate rewrite can tie. */
  const touch = async (rel: string, text: string): Promise<void> => {
    await write(rel, text);
    const when = new Date(Date.now() + 2000);
    await fs.utimes(path.join(dir, rel), when, when);
  };

  it("reports a note that was edited while it was open", async () => {
    await write("aws/lambda.md", "before");
    const opened = new OpenedNotes(dir);
    await opened.opened("aws/lambda.md");
    await touch("aws/lambda.md", "after");
    expect(await opened.changed()).toEqual(["aws/lambda.md"]);
  });

  it("says nothing about a note that was only looked at", async () => {
    await write("aws/lambda.md", "before");
    const opened = new OpenedNotes(dir);
    await opened.opened("aws/lambda.md");
    expect(await opened.changed()).toEqual([]);
  });

  it("keeps the mtime from the FIRST open, not the most recent", async () => {
    // Re-opening a note mid-edit must not adopt the edited mtime as the
    // baseline — that would silently forget the change the user just made.
    await write("aws/lambda.md", "before");
    const opened = new OpenedNotes(dir);
    await opened.opened("aws/lambda.md");
    await touch("aws/lambda.md", "after");
    await opened.opened("aws/lambda.md");
    expect(await opened.changed()).toEqual(["aws/lambda.md"]);
  });

  it("counts a note that disappeared, and one that appeared", async () => {
    await write("gone.md", "here");
    const opened = new OpenedNotes(dir);
    await opened.opened("gone.md");
    await opened.opened("never.md");
    await fs.rm(path.join(dir, "gone.md"));
    // `never.md` was unreadable at both ends and compares equal, correctly.
    expect(await opened.changed()).toEqual(["gone.md"]);
  });

  it("narrows to the paths asked about", async () => {
    // A long-lived process outlives a session; the previous session's notes
    // are not this session's news.
    await write("a.md", "a");
    await write("b.md", "b");
    const opened = new OpenedNotes(dir);
    await opened.opened("a.md");
    await opened.opened("b.md");
    await touch("a.md", "a!");
    await touch("b.md", "b!");
    expect(await opened.changed(["b.md"])).toEqual(["b.md"]);
  });
});
