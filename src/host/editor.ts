/**
 * Which program opens a note, and how it is told about a line.
 *
 * All of this is pure and injectable — no spawn, no filesystem beyond an
 * `mtime` read — which is why it sits in `host` rather than in either
 * interface. Both need it byte-identically: the CLI's `o` and the app's open
 * button are the same promise to the user, and an editor table copied into a
 * second place is how `code` starts landing on line 1 in one of them
 * (ADR 0013 — the two are peers, so what they share lives here).
 *
 * The spawn is deliberately NOT here. A terminal editor holds the TTY and must
 * be awaited; a GUI has no TTY to hand over and must not block. Those are
 * different enough that each interface owns its own, over this one command.
 */

import { stat } from "node:fs/promises";
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
