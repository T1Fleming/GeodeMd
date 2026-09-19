/**
 * Opening the note a card came from. Spawning a program that takes over the
 * terminal is terminal I/O, so it lives in `cli` (section 6 rule 2) and `core`
 * knows nothing about it.
 *
 * The interesting half is pure: `resolveEditor` and `editorCommand` decide the
 * whole command line from data, so every editor family is a test rather than
 * something discovered when a stray `+142` file appears in a notes directory.
 */

import { spawn } from "node:child_process";

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
 * Run it and wait. That is right for both shapes this can take: a terminal
 * editor holds the TTY until you quit it, and a GUI opener returns at once.
 * Returns a short message when it could not be run — a missing editor should
 * cost you one dim line, not the rest of the session.
 */
export async function openInEditor(
  file: string,
  line: number | null,
  editor: string | null,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const { cmd, args } = editorCommand(editor, file, line, platform);
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", (err: NodeJS.ErrnoException) => {
      resolve(
        err.code === "ENOENT"
          ? `could not run \`${cmd}\` — set \`editor\` in your config, or $EDITOR`
          : `could not run \`${cmd}\`: ${err.message}`,
      );
    });
    child.on("close", (code) => {
      resolve(code === 0 || code === null ? null : `\`${cmd}\` exited with code ${code}`);
    });
  });
}
