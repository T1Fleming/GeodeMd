/**
 * The first-run sequence, as a pure state machine.
 *
 * The CLI's `init` writes a config, prints two sentences of advice, and exits.
 * A GUI cannot print-and-exit — it has to carry the user through, and the
 * stakes are specific: **the first real sync writes an id comment into every
 * note that contains a card.** On an existing collection that is a diff across
 * the whole tree, and a written config can only warn about it in a sentence.
 *
 * So the one rule this file exists to enforce is that the irreversible step is
 * unreachable without having just seen what it would do. That is not a layout
 * concern, and it is the kind of thing that breaks quietly — pick a folder,
 * preview it, go back, pick a *different* folder, and a version without this
 * would happily sync the second one against the first one's preview.
 */

import type { ConfigProposal, FolderReport, SyncSummary } from "../../ipc.js";

export type Step = "welcome" | "confirm" | "config" | "vcs" | "preview";

/** In order. `back` and `next` walk this rather than hard-coding neighbours. */
export const STEPS: readonly Step[] = ["welcome", "confirm", "config", "vcs", "preview"];

/**
 * Where the sequence was entered from, when it was not a first run.
 *
 * `repair` is a vault whose folder has gone; `change` is the user asking to
 * point the open vault somewhere else (#43); `add` is a new vault beside it
 * ([ADR 0027](../../../../docs/decisions/0027-vaults.md)). All three carry
 * the open vault's folder and id on the way in, because all three can end
 * with that vault being wanted back — and by then the config on disk may no
 * longer say what it was.
 */
export interface From {
  reason: "repair" | "change" | "add";
  notesPath: string;
  vault: string;
}

export interface Setup {
  step: Step;
  from: From | null;
  folder: FolderReport | null;
  proposal: ConfigProposal | null;
  /**
   * Replace the existing config? Null means unanswered.
   *
   * Only ever *asked* when there is one to replace, so a first run leaves it
   * null and is not blocked by it. `false` is a deliberate dead end rather
   * than an alternative route — see `blockers`.
   */
  replace: boolean | null;
  /** The one explicit acknowledgement. Not a blocker anywhere else. */
  acknowledged: boolean;
  /**
   * Why this folder would overlap another vault, or null. Asked when the
   * folder is picked, so the refusal is on the folder step rather than a
   * failed write three steps later.
   */
  overlap: string | null;
  /**
   * The dry run. Null until one has finished **for the current folder** —
   * changing the folder clears it, which is the whole point.
   */
  preview: SyncSummary | null;
  /**
   * Whether this sequence has written the config yet. The preview writes it
   * before its dry run, because the run reads it — so from then on, leaving
   * without finishing has to put the old folder back. See `restoreTo`.
   */
  wrote: boolean;
  /**
   * The id of the vault this sequence added, once it has. Kept here rather
   * than read from the proposal, because picking another folder replaces the
   * proposal — and the vault to undo is the one that was written.
   */
  added: string | null;
}

/**
 * A first run opens at the welcome; a repair or a change opens at the folder
 * step, because the user already knows what this is.
 */
export function begin(from: From | null = null): Setup {
  return {
    step: from ? "confirm" : "welcome",
    from,
    folder: null,
    overlap: null,
    proposal: null,
    replace: null,
    acknowledged: false,
    preview: null,
    wrote: false,
    added: null,
  };
}

/**
 * A folder was chosen.
 *
 * Everything downstream is discarded, not merged. A proposal is about a
 * specific path and a preview is about a specific tree; carrying either across
 * a change of folder is how the user ends up looking at one collection's
 * numbers while a different one is about to be rewritten.
 */
export function picked(s: Setup, report: FolderReport, overlap: string | null = null): Setup {
  return { ...s, step: "confirm", folder: report, overlap, proposal: null, preview: null };
}

/**
 * Which write this sequence ends in: re-pointing the open vault, or adding a
 * new one. Everything from the proposal to the undo follows from it.
 */
export function mode(s: Setup): "point" | "add" {
  return s.from?.reason === "add" ? "add" : "point";
}

export function proposed(s: Setup, proposal: ConfigProposal): Setup {
  // A fresh proposal re-opens the keep-or-replace question rather than
  // inheriting an answer given about a different config.
  return { ...s, proposal, replace: null };
}

export function setReplace(s: Setup, value: boolean): Setup {
  return { ...s, replace: value };
}

export function setAcknowledged(s: Setup, value: boolean): Setup {
  return { ...s, acknowledged: value };
}

export function previewed(s: Setup, summary: SyncSummary): Setup {
  return { ...s, preview: summary };
}

export function wroteConfig(s: Setup, added: string | null = null): Setup {
  return { ...s, wrote: true, added: added ?? s.added };
}

/**
 * The folder to write back when leaving without finishing, or null when
 * nothing needs undoing.
 *
 * Taken from `from`, never from the proposal. A proposal is read from the
 * config on disk, so after one preview it describes the folder *just
 * written* — restoring from it would restore the wrong thing. A first run has
 * nothing to restore: there was no config before it.
 */
export function restoreTo(s: Setup): string | null {
  return s.wrote && s.from && s.from.reason !== "add" ? s.from.notesPath : null;
}

/**
 * What undoing an add means: switch back to the vault that was open, then
 * take the new one out of the list — database included, since the only thing
 * in it is this sequence's preview. Null when nothing was added.
 *
 * Also what a second preview does first, when the folder was changed after
 * the first one added a vault: the vault in the list must be the one being
 * previewed, not the one picked before.
 */
export function abandonAdd(s: Setup): { back: string; remove: string } | null {
  if (s.from?.reason !== "add" || s.added === null) return null;
  return { back: s.from.vault, remove: s.added };
}

/** Undone: nothing added any more, so there is nothing to undo on the way out. */
export function abandoned(s: Setup): Setup {
  return { ...s, added: null, wrote: false };
}

/**
 * A change to a folder with no notes in it — typically one just made in the
 * picker. Correct, and it empties the collection, which reads as loss unless
 * the screen says the old cards are still where they were.
 */
export function leavesCollectionBehind(s: Setup): boolean {
  return s.from?.reason === "change" && folderIsUsable(s.folder) && s.folder!.markdownFiles === 0;
}

/**
 * A change or an add can be cancelled. A repair cannot: it has no working
 * folder to go back to — though the switcher can still leave it for another
 * vault.
 */
export function canCancel(s: Setup): boolean {
  return s.from?.reason === "change" || s.from?.reason === "add";
}

/** A usable place to keep notes. Empty is fine; missing or a file is not. */
export function folderIsUsable(f: FolderReport | null): boolean {
  return f !== null && f.exists && f.isDirectory;
}

/**
 * Why the current step will not let you move on, or an empty list.
 *
 * Returned as reasons rather than a bare boolean so the screen can say which
 * one is missing. A disabled button with no explanation is the version of this
 * that gets filed as a bug.
 */
export function blockers(s: Setup): string[] {
  switch (s.step) {
    case "welcome":
      return folderIsUsable(s.folder) ? [] : ["Choose the folder your notes live in."];
    case "confirm":
      if (s.from?.reason === "change" && s.folder === null) {
        return ["Choose the folder to use instead."];
      }
      if (s.from?.reason === "add" && s.folder === null) {
        return ["Choose the folder for the new vault."];
      }
      if (!folderIsUsable(s.folder)) return ["That folder is not there any more."];
      // Not for a repair: reconnecting the drive and picking the same path is
      // exactly how a repair is meant to end.
      if (s.from?.reason === "change" && s.folder!.path === s.from.notesPath) {
        return ["That is already your notes folder."];
      }
      // After the same-folder check, so a change says the plainer thing.
      if (s.overlap) return [s.overlap];
      return [];
    case "config":
      if (!s.proposal) return ["Still reading your existing settings."];
      if (s.proposal.mode === "add") return [];
      // Only a real question when there is something to replace — and only
      // `true` gets past it. Keeping the old settings is not a way forward
      // through this sequence; it is a way OUT of it, handled by the screen,
      // because the sequence exists to point at the new folder.
      return s.proposal.replaces && s.replace !== true
        ? ["Choose whether to use the new folder."]
        : [];
    case "vcs":
      return s.acknowledged ? [] : ["Tick the box to confirm you have read this."];
    case "preview":
      return canSync(s) ? [] : ["Run the preview first."];
  }
}

export function canAdvance(s: Setup): boolean {
  return blockers(s).length === 0;
}

/**
 * The irreversible step, and the only gate that really matters.
 *
 * True only when a preview has completed **for this folder**. `picked` clears
 * the preview, so going back and choosing somewhere else takes this back to
 * false rather than letting the old run's numbers authorise the new one.
 */
export function canSync(s: Setup): boolean {
  return s.preview !== null && folderIsUsable(s.folder);
}

export function next(s: Setup): Setup {
  if (!canAdvance(s)) return s;
  const at = STEPS.indexOf(s.step);
  const to = STEPS[at + 1];
  return to ? { ...s, step: to } : s;
}

export function back(s: Setup): Setup {
  const at = STEPS.indexOf(s.step);
  const to = STEPS[at - 1];
  // A repair or a change starts at the folder step; the welcome before it is
  // a first run's, and walking back into it would greet a returning user.
  if (!to || (s.from && to === "welcome")) return s;
  return { ...s, step: to };
}

/**
 * What the preview means in words.
 *
 * `filesStamped` is the number this screen exists for — **how many of your
 * notes this edits** — and it is not `cardsNew`, because one file can hold
 * fifty cards. Returned as parts so the screen can emphasise that one.
 */
export interface PreviewReport {
  filesRead: number;
  cardsFound: number;
  notesEdited: number;
}

export function previewReport(summary: SyncSummary): PreviewReport {
  return {
    filesRead: summary.filesRead,
    cardsFound: summary.cardsFound,
    notesEdited: summary.filesStamped,
  };
}
