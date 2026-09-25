/**
 * A card's note, for the two channels that touch one: `note/open` hands it to
 * an editor, `note/read` returns its text to the viewer (#51).
 *
 * No Electron import, like `runs.ts` and `active.ts`, so the confinement is
 * tested under plain vitest against a real vault — including a stored `..`.
 */

import * as path from "node:path";
import { classify } from "../../host/errors.js";
import type { NoteText, Result } from "../ipc.js";
import type { Open } from "./active.js";

/**
 * The absolute path of a note, or null when `filePath` would leave the notes
 * folder.
 *
 * Resolve, then check the prefix. `filePath` comes from a card row and is
 * relative by construction, but the renderer is what sends it, and a stored
 * `..` must not be able to reach out of the notes folder — to hand an
 * arbitrary file to a spawn, or to read one into the window.
 */
export function withinNotes(notesPath: string, filePath: string): string | null {
  const root = path.resolve(notesPath);
  const abs = path.resolve(root, filePath);
  return abs.startsWith(root + path.sep) ? abs : null;
}

/** Why a path was refused, in the words both channels use. */
export function outside(filePath: string): Result<never> {
  return { ok: false, kind: "config", message: `${filePath} is outside your notes folder` };
}

/**
 * The note's text as it is on disk, and the line the card is on now.
 *
 * `open` is the vault the review was drawn from — the caller gets it through
 * `Active.ensureVault`, so a read that arrives after a switch is refused
 * rather than answered with a note of the same name from another folder.
 */
export async function readNote(open: Open, filePath: string, cardId: string): Promise<Result<NoteText>> {
  if (withinNotes(open.config.notesPath, filePath) === null) return outside(filePath);
  try {
    const { text, line } = await open.core.readNote(filePath, cardId);
    return { ok: true, value: { text, line } };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: false,
        kind: "config",
        message: `${filePath} is not in your notes folder any more — sync to catch up`,
      };
    }
    return { ok: false, kind: classify(err), message: err instanceof Error ? err.message : String(err) };
  }
}
