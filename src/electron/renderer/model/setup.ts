/**
 * The first-run sequence, as a pure state machine.
 *
 * The CLI's `init` writes a config, prints two sentences of advice, and exits.
 * A GUI cannot print-and-exit — it has to carry the user through, and the
 * stakes are specific: **the first real sync writes an id comment into every
 * note that contains a card.** On an existing collection that is a diff across
 * the whole tree, and `geode init` can only warn about it in a sentence.
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

export interface Setup {
  step: Step;
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
   * The dry run. Null until one has finished **for the current folder** —
   * changing the folder clears it, which is the whole point.
   */
  preview: SyncSummary | null;
}

export function begin(): Setup {
  return {
    step: "welcome",
    folder: null,
    proposal: null,
    replace: null,
    acknowledged: false,
    preview: null,
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
export function picked(s: Setup, report: FolderReport): Setup {
  return { ...s, step: "confirm", folder: report, proposal: null, preview: null };
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
      if (!folderIsUsable(s.folder)) return ["That folder is not there any more."];
      return [];
    case "config":
      if (!s.proposal) return ["Still reading your existing settings."];
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
  return to ? { ...s, step: to } : s;
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
