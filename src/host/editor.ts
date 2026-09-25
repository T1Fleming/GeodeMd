/**
 * Which program opens a note, and how it is told about a line.
 *
 * All of this is pure and injectable — no spawn, and no filesystem beyond an
 * `mtime` read and the "is it installed?" check that `thisMachine` hands in —
 * which is why it sits in `host` rather than in either interface. Both need it byte-identically: the CLI's `o` and the app's open
 * button are the same promise to the user, and an editor table copied into a
 * second place is how `code` starts landing on line 1 in one of them
 * (ADR 0013 — the two are peers, so what they share lives here).
 *
 * The spawn is deliberately NOT here. A terminal editor holds the TTY and must
 * be awaited; a GUI has no TTY to hand over and must not block. Those are
 * different enough that each interface owns its own, over this one command.
 */

import { accessSync, constants } from "node:fs";
import { stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/** `editor +142 <file>` — the classic Unix convention. */
const PLUS_LINE = new Set([
  "vi",
  "vim",
  "nvim",
  "view",
  "nano",
  "pico",
  "emacs",
  "emacsclient",
  "kak",
  "joe",
  "gedit",
  "micro",
]);

/** `editor --goto <file>:142` — the VS Code family. */
const GOTO = new Set(["code", "code-insiders", "codium", "vscodium", "cursor", "windsurf"]);

/** `editor <file>:142` — the path itself carries the line. */
const SUFFIX = new Set(["subl", "sublime_text", "zed", "hx", "helix"]);

/**
 * Config wins over the environment, and the environment over the OS default.
 * `null` means "no editor was named" — not a failure; it selects the platform
 * opener below, which is what sends a `.md` to whatever app owns it.
 */
export function resolveEditor(
  configured: string | undefined,
  env: NodeJS.ProcessEnv,
): string | null {
  for (const candidate of [configured, env["VISUAL"], env["EDITOR"]]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
  }
  return null;
}

/**
 * The platform's "open this with whatever owns it", none of which can be told
 * about a line.
 *
 * Windows goes through `rundll32` rather than the more obvious
 * `cmd /c start "" <file>` for the same reason `editorCommand` below refuses to
 * shell-parse: `cmd.exe` re-parses its arguments. Node quotes an argument only
 * when it contains a space, tab, or quote, so a note named `note&calc.md` would
 * reach `cmd` unquoted and the `&` would run as a command separator — and a
 * notes directory is frequently a shared or synced folder. `rundll32` consults
 * the same file associations and parses nothing.
 */
function osOpener(file: string, platform: NodeJS.Platform): { cmd: string; args: string[] } {
  if (platform === "darwin") return { cmd: "open", args: [file] };
  if (platform === "win32") {
    return { cmd: "rundll32.exe", args: ["url.dll,FileProtocolHandler", file] };
  }
  return { cmd: "xdg-open", args: [file] };
}

/**
 * Split on whitespace so `EDITOR="code -w"` works. Deliberately not a shell
 * parse: quoting rules would buy one exotic case and cost a shell, and running
 * the value through `sh -c` turns a config typo into arbitrary execution.
 */
export function editorCommand(
  editor: string | null,
  file: string,
  line: number | null,
  platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[] } {
  if (editor === null) return osOpener(file, platform);

  const parts = editor.split(/\s+/).filter(Boolean);
  const cmd = parts[0];
  if (cmd === undefined) return osOpener(file, platform);
  const extra = parts.slice(1);

  // Split on both separators rather than using `path.basename`: the platform
  // being targeted is an argument here, and on POSIX `basename` would keep a
  // Windows path whole and fail to recognise the editor inside it.
  const name = (cmd.split(/[\\/]/).pop() ?? cmd).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();

  if (line === null) return { cmd, args: [...extra, file] };
  if (PLUS_LINE.has(name)) return { cmd, args: [...extra, `+${line}`, file] };
  if (GOTO.has(name)) return { cmd, args: [...extra, "--goto", `${file}:${line}`] };
  if (SUFFIX.has(name)) return { cmd, args: [...extra, `${file}:${line}`] };

  // An unfamiliar editor gets the path and nothing else. Handing it `+142`
  // risks creating a file with that name, which is a worse outcome than
  // landing on line 1.
  return { cmd, args: [...extra, file] };
}

/**
 * The machine an editor is looked for on. Injected whole so that detection
 * and lookup are testable against a fake `PATH` and fake installs, and so
 * both branches of the macOS app-bundle search run on any machine.
 */
export interface Machine {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  /** Is there a file here that can be run? */
  isExecutable: (file: string) => boolean;
}

export function thisMachine(): Machine {
  return {
    env: process.env,
    platform: process.platform,
    home: os.homedir(),
    isExecutable: (file) => {
      try {
        accessSync(file, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Where each editor's command-line launcher sits inside its macOS app bundle,
 * relative to `/Applications` or `~/Applications`.
 *
 * This table exists because **a Mac app opened from Finder or the Dock does
 * not get your shell's `PATH`**. It gets `/usr/bin:/bin:/usr/sbin:/sbin`, so
 * `code` works under `npm start` from a terminal and is not found in a
 * packaged build. Only the VS Code entry has been checked on a real install;
 * the others follow each app's published layout.
 *
 * Zed's launcher is called `cli`, which is why this maps name to path rather
 * than assuming the file is named after the command.
 */
const MAC_BUNDLES: Readonly<Record<string, string>> = {
  code: "Visual Studio Code.app/Contents/Resources/app/bin/code",
  "code-insiders":
    "Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders",
  cursor: "Cursor.app/Contents/Resources/app/bin/cursor",
  windsurf: "Windsurf.app/Contents/Resources/app/bin/windsurf",
  codium: "VSCodium.app/Contents/Resources/app/bin/codium",
  zed: "Zed.app/Contents/MacOS/cli",
  subl: "Sublime Text.app/Contents/SharedSupport/bin/subl",
};

/**
 * The editors the app offers to choose from, when installed.
 *
 * Only those `editorCommand` can put on the card's line, and **no terminal
 * editors**: the app spawns detached with no TTY, so `vim` would start in a
 * window nobody can type into. They stay reachable by typing a command, for
 * anyone who wraps one in a terminal launcher.
 */
const GUI_EDITORS: ReadonlyArray<{ command: string; label: string }> = [
  { command: "code", label: "Visual Studio Code" },
  { command: "code-insiders", label: "Visual Studio Code - Insiders" },
  { command: "cursor", label: "Cursor" },
  { command: "windsurf", label: "Windsurf" },
  { command: "codium", label: "VSCodium" },
  { command: "zed", label: "Zed" },
  { command: "subl", label: "Sublime Text" },
  { command: "gedit", label: "gedit" },
];

export interface DetectedEditor {
  /** What goes in the config's `editor` key: a plain name, never a path. */
  command: string;
  label: string;
}

/** The GUI editors installed here, in a fixed order. */
export function detectEditors(machine: Machine): DetectedEditor[] {
  return GUI_EDITORS.filter((e) => locateExecutable(e.command, machine) !== null).map(
    (e) => ({ ...e }),
  );
}

/**
 * The file a command name runs, or null when it is not installed.
 *
 * `PATH` first, so a launcher the user put there wins; then, on macOS, the
 * app bundles above. A name that already contains a separator is taken as a
 * path and only checked.
 */
export function locateExecutable(name: string, machine: Machine): string | null {
  const p = machine.platform === "win32" ? path.win32 : path.posix;
  if (/[\\/]/.test(name)) return machine.isExecutable(name) ? name : null;

  const exts = machine.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of (machine.env["PATH"] ?? "").split(p.delimiter)) {
    if (dir === "") continue;
    for (const ext of exts) {
      const candidate = p.join(dir, name + ext);
      if (machine.isExecutable(candidate)) return candidate;
    }
  }

  const bundled = machine.platform === "darwin" ? MAC_BUNDLES[name] : undefined;
  if (bundled !== undefined) {
    for (const root of ["/Applications", p.join(machine.home, "Applications")]) {
      const candidate = p.join(root, bundled);
      if (machine.isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

export type Launch =
  | { ok: true; cmd: string; args: string[] }
  | { ok: false; message: string };

/**
 * What to spawn for `o`: `editorCommand`, with the command resolved to a file.
 *
 * The config keeps a plain name (`"code"`) and it is resolved here, at open
 * time, rather than a path being stored — `editorCommand` splits the value on
 * whitespace, and `/Applications/Visual Studio Code.app/…` would split at its
 * spaces. The line flag is chosen from the NAME, before resolving, which is
 * what lets Zed's `cli` still land on the line.
 *
 * An editor that is named and cannot be found is a failure, **not** a quiet
 * fall back to the OS opener: that would open the note at the top, and the
 * user would have no way to tell why the line jump had stopped working.
 */
export function launchCommand(
  editor: string | null,
  file: string,
  line: number | null,
  machine: Machine,
): Launch {
  const { cmd, args } = editorCommand(editor, file, line, machine.platform);
  // The OS opener is a system command and needs no lookup.
  if (editor === null || editor.trim() === "") return { ok: true, cmd, args };

  const found = locateExecutable(cmd, machine);
  if (found === null) {
    return {
      ok: false,
      message: `the editor \`${cmd}\` was not found — choose another on the Vault screen`,
    };
  }
  return { ok: true, cmd: found, args };
}

/** Null when the file cannot be read — an unreadable note is not an error here. */
async function mtimeOf(file: string): Promise<number | null> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * The notes opened during one review session, against the mtime each had when
 * it was first opened.
 *
 * Compared once at the end rather than when the editor returns, and that is
 * the whole reason this is a session-long object rather than a check around
 * the spawn: **only a terminal editor holds the process until you quit it.**
 * `code`, `subl`, `zed` and every OS opener hand the file to a running instance
 * and return in milliseconds — long before anything has been typed. Comparing
 * immediately would therefore report nothing in exactly the setup where the
 * user is most likely to still be editing while the session runs (ADR 0012).
 *
 * Shared by both interfaces because the queue is a snapshot in both: a note
 * edited mid-session is stale on screen, and nothing else would say so.
 */
export class OpenedNotes {
  /** Relative path -> mtime when first opened. Null means it could not be read. */
  private readonly at = new Map<string, number | null>();

  constructor(private readonly notesPath: string) {}

  /** Record a note as opened. The first open wins; re-opening is not a reset. */
  async opened(relPath: string): Promise<void> {
    if (this.at.has(relPath)) return;
    this.at.set(relPath, await mtimeOf(path.join(this.notesPath, relPath)));
  }

  /**
   * Which of them changed. `only` narrows the answer to one session's paths,
   * which matters in a long-lived process where this object outlives a session.
   */
  async changed(only?: readonly string[]): Promise<string[]> {
    const out: string[] = [];
    for (const [rel, before] of this.at) {
      if (only && !only.includes(rel)) continue;
      // `!==` covers a note that was created or removed while it was open, not
      // only one that was rewritten; two unreadable reads compare equal and are
      // correctly not a change.
      if ((await mtimeOf(path.join(this.notesPath, rel))) !== before) out.push(rel);
    }
    return out;
  }
}
