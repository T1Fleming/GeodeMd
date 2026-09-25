/**
 * Opening a card's note from the app.
 *
 * Deliberately not `shell.openPath`, which would be one line: it ignores the
 * configured `editor` and cannot be told a line number, so the note would open
 * in the wrong program at the top of the file — silently different from what
 * `o` does in the CLI, which is the one thing a second interface must not be
 * (ADR 0013). The command comes from `host/editor.ts`, the same table the CLI
 * uses; only the spawn differs.
 *
 * And it differs for a reason. `cli/editor.ts` uses `stdio: "inherit"` and
 * awaits the child, which is a terminal contract — right for `vim`, which
 * holds the TTY until you quit it. A GUI has no TTY to hand over and must not
 * block on the editor exiting, so this one is `ignore` + `detached` + `unref`:
 * spawn it and forget it.
 *
 * No Electron import anywhere in this file, so it runs under plain vitest.
 */

import { spawn } from "node:child_process";
import { launchCommand, thisMachine } from "../../host/editor.js";
import type { Machine } from "../../host/editor.js";

export interface Launched {
  launched: boolean;
  /** Set only when it could not be run. Shown as a note, never as a dialog. */
  message?: string;
}

/**
 * How long to wait to hear that the spawn failed.
 *
 * Node emits exactly one of `spawn` or `error`, so this timer should never
 * fire. It exists because three separate failures in this app have presented
 * as a silent hang rather than an error, and a promise that never settles here
 * freezes the review screen on a keypress. Timing out reports the honest
 * thing: nothing said it failed.
 */
const SPAWN_TIMEOUT_MS = 2_000;

/**
 * Launch the editor and return as soon as the process exists — NOT when it
 * exits. Waiting for the exit would hang the app for as long as the user keeps
 * the note open, which for a GUI editor is the normal case.
 *
 * `spawn`/`error` rather than resolving optimistically: ENOENT arrives
 * asynchronously, so returning immediately would report success for an editor
 * that is not installed, which is the single most likely failure here.
 */
export async function openDetached(
  file: string,
  line: number | null,
  editor: string | null,
  machine: Machine = thisMachine(),
): Promise<Launched> {
  // Resolved against PATH and the app bundles first: a named editor that is
  // not installed is reported here, before anything is spawned (see
  // `launchCommand` for why it never falls back to the OS opener).
  const launch = launchCommand(editor, file, line, machine);
  if (!launch.ok) return { launched: false, message: launch.message };
  const { cmd, args } = launch;

  return new Promise<Launched>((resolve) => {
    let settled = false;
    const done = (value: Launched): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => done({ launched: true }), SPAWN_TIMEOUT_MS);
    timer.unref();

    let child;
    try {
      child = spawn(cmd, args, { stdio: "ignore", detached: true });
    } catch (err) {
      // A synchronous throw is rare but real — an argument the platform
      // rejects outright never reaches the `error` event.
      done({ launched: false, message: failure(cmd, err) });
      return;
    }

    child.on("error", (err: NodeJS.ErrnoException) => {
      done({ launched: false, message: failure(cmd, err) });
    });
    child.on("spawn", () => {
      // Detached AND unref'd: the editor outlives the app, and the app can
      // quit without waiting for it. Only together do both hold.
      child.unref();
      done({ launched: true });
    });
  });
}

function failure(cmd: string, err: unknown): string {
  const e = err as NodeJS.ErrnoException;
  return e?.code === "ENOENT"
    ? `could not run \`${cmd}\` — choose another editor on the Vault screen`
    : `could not run \`${cmd}\`: ${e instanceof Error ? e.message : String(err)}`;
}
