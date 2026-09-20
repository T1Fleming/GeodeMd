/**
 * Spawning the editor, the terminal way.
 *
 * Only the spawn lives here. Deciding *what* to run — `resolveEditor`, the
 * editor tables, `editorCommand` — is pure and shared, and moved to
 * `host/editor.ts` when the app needed the same answers (ADR 0016's
 * consolidation, deferred until a second interface existed).
 *
 * What stays is a terminal contract rather than a detail: `stdio: "inherit"`
 * and awaiting the child are right for `vim`, which takes over the TTY, and
 * wrong for a GUI, which has none to hand over. The app therefore has its own
 * spawn over the same command, rather than reaching across for this one.
 */

import { spawn } from "node:child_process";
import { editorCommand } from "../host/editor.js";

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
