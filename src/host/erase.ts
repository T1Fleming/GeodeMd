/**
 * Erasing GeodeMD from a vault's notes folder (ADR 0035): every stamp out of
 * every note, then `.sr/` deleted. What the database and the vault list need
 * afterwards is `config.ts`'s; the order the whole thing runs in, and closing
 * an open vault first, is the app's.
 *
 * In `host` because it is this machine's folder and nothing about it is a
 * decision the renderer should make; it reaches `core` for the stamps and
 * `files` for `.sr/`, as `open.ts` reaches `core` for a `Core`.
 */

import { unstampNotes } from "../core/index.js";
import type { Unstamped } from "../core/index.js";
import { describeSr, removeSrDir } from "../files/index.js";
import type { SrContents } from "../files/index.js";
import { VaultRefused } from "./config.js";

export interface ErasePreview {
  stamps: Pick<Unstamped, "files" | "stamps" | "unreadable">;
  sr: SrContents;
}

/** What erasing would remove from `notesPath`. Writes nothing. */
export async function previewErase(notesPath: string): Promise<ErasePreview> {
  const { files, stamps, unreadable } = await unstampNotes(notesPath, { dryRun: true });
  return { stamps: { files, stamps, unreadable }, sr: await describeSr(notesPath) };
}

/**
 * Take every stamp out of the notes, then delete `.sr/`.
 *
 * **Stops before `.sr/` when any note was left with a stamp** — edited while
 * this ran, or unreadable — and says which. Nothing else has been removed by
 * then, so running it again finishes the job; deleting `.sr/` first would
 * leave stamped notes behind with nothing to say whose they were.
 */
export async function eraseNotesFolder(notesPath: string): Promise<{ files: number; stamps: number }> {
  const done = await unstampNotes(notesPath);
  const left = [...done.changedUnderneath, ...done.unreadable];
  if (left.length > 0) {
    const named = left.slice(0, 5).join(", ") + (left.length > 5 ? `, and ${left.length - 5} more` : "");
    throw new VaultRefused(
      `${left.length} ${left.length === 1 ? "note" : "notes"} could not be changed (${named}) — ` +
        "nothing else was removed; close them in your editor and erase again",
    );
  }
  await removeSrDir(notesPath);
  return { files: done.files, stamps: done.stamps };
}
