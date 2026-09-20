/**
 * The review vocabulary, shared by both interfaces.
 *
 * None of this is rendering — it is what a key or a button *means*, and what a
 * rating is called. The CLI draws it with ANSI and the app will draw it with
 * CSS, but if the two disagree about what `3` does, or about whether `escape`
 * quits, that is a usability bug no test would catch because each interface
 * would be self-consistent.
 *
 * Nothing here touches a terminal, so `boundaries.test.ts` can enforce that
 * the module stays shareable.
 */

import type { SyncPhase, SyncSummary } from "../core/index.js";

/**
 * The four FSRS ratings, and what they are called. Spec section 9: the numbers
 * are not guessable, so the words travel with them everywhere they are shown.
 */
export const RATING_KEYS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["1", "again"],
  ["2", "hard"],
  ["3", "good"],
  ["4", "easy"],
];

/** Everything at the prompt that is not a rating. */
export const ACTION_KEYS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["o", "open"],
  ["q", "quit"],
];

export type KeyAction =
  | { kind: "quit" }
  | { kind: "rate"; rating: 1 | 2 | 3 | 4 }
  | { kind: "open" }
  | { kind: "ignore" };

/** Ctrl-C as it arrives from a raw-mode keypress. Terminal-only, harmless here. */
const ETX = String.fromCharCode(3);

/**
 * What a keypress means at the rating prompt.
 *
 * Pure, so the decisions are testable without a pseudo-terminal — and shared,
 * so a GUI's key handler cannot drift from the CLI's. A renderer passes the
 * same strings (`event.key`), and gets the same answers.
 *
 * `ignore` rather than a throw or a default rating: an unrecognised key at a
 * rating prompt must do nothing, because the alternative is recording a rating
 * the user did not choose.
 */
export function interpretKey(key: string): KeyAction {
  if (key === "q" || key === "Q" || key === ETX || key === "escape" || key === "Escape") {
    return { kind: "quit" };
  }
  if (key >= "1" && key <= "4") return { kind: "rate", rating: Number(key) as 1 | 2 | 3 | 4 };
  if (key === "o" || key === "O") return { kind: "open" };
  return { kind: "ignore" };
}

/** Ratings given in a session, by rating. */
export interface RatingCounts {
  1: number;
  2: number;
  3: number;
  4: number;
}

export function emptyCounts(): RatingCounts {
  return { 1: 0, 2: 0, 3: 0, 4: 0 };
}

/**
 * Which ratings to mention in a session summary, and in which order.
 *
 * The policy — name the ratings actually given, in rating order, skipping the
 * ones at zero — is interface-independent. Turning it into a sentence or a row
 * of tiles is not, so that stays with whoever is drawing.
 */
export function ratingBreakdown(counts: RatingCounts): Array<{ label: string; count: number }> {
  return RATING_KEYS.filter(([key]) => counts[Number(key) as 1 | 2 | 3 | 4] > 0).map(
    ([key, label]) => ({ label, count: counts[Number(key) as 1 | 2 | 3 | 4] }),
  );
}

/**
 * One count from a `SyncSummary`, ready to be laid out.
 *
 * Data rather than a sentence, because the two interfaces lay the same counts
 * out differently — the CLI joins them with commas, the app puts them in a
 * grid — while *which* counts are worth showing is the same question in both.
 */
export interface SummaryField {
  /** The `SyncSummary` key, so an interface can special-case one if it must. */
  key: string;
  label: string;
  value: number;
  /**
   * A breakdown of the field before it: `unchanged` and `read` split `files`.
   *
   * Marked rather than inferred so neither interface has to hard-code the
   * relationship. The CLI renders these in parentheses — `10 files (9
   * unchanged, 1 read)` — and a grid can indent them or drop them.
   */
  detail?: boolean;
}

/**
 * Which counts a sync summary should show, and in which order.
 *
 * The policy is: **the core counts always, the incidentals only when they are
 * non-zero.** A run that pruned nothing should not say "0 pruned" — the list
 * is long enough that a reader stops seeing it — but a run that skipped a file
 * must say so, because the exit code deliberately does not.
 *
 * `filesStamped` leads the incidentals on purpose. On a dry run it is the
 * number the user is actually deciding on: the first sync of an existing
 * collection rewrites every file that holds a card, and `cardsNew` does not
 * answer "how many of my notes does this edit" — one file can hold fifty.
 */
export function summaryFields(s: SyncSummary): SummaryField[] {
  const fields: SummaryField[] = [
    { key: "filesEnumerated", label: "files", value: s.filesEnumerated },
    { key: "filesUnchanged", label: "unchanged", value: s.filesUnchanged, detail: true },
    { key: "filesRead", label: "read", value: s.filesRead, detail: true },
    { key: "cardsFound", label: "cards found", value: s.cardsFound },
    { key: "cardsNew", label: "new", value: s.cardsNew },
    { key: "cardsUpdated", label: "updated", value: s.cardsUpdated },
  ];

  const incidental: Array<[keyof SyncSummary, string]> = [
    ["filesStamped", "files stamped"],
    ["cardsPruned", "pruned"],
    ["filesDeferred", "deferred"],
    ["filesSyncConflict", "sync conflicts left alone"],
    ["duplicatesReminted", "duplicate ids re-minted"],
    ["symlinkedDirsSkipped", "symlinked dirs skipped"],
    ["reviewsIngested", "reviews ingested"],
    ["filesSkippedOnError", "files skipped on error"],
    ["logLinesSkipped", "bad log lines skipped"],
  ];

  for (const [key, label] of incidental) {
    const value = s[key] as number;
    if (value) fields.push({ key, label, value });
  }
  return fields;
}

/**
 * Why a freshly-edited file was left alone, or null when none was.
 *
 * Without this the summary reads "3 cards found, 0 new" and looks like a bug —
 * which on a first run, where the notes were written moments ago, is exactly
 * when it happens. A file modified in the last couple of seconds is assumed to
 * be open in an editor and nothing is minted into it.
 *
 * The explanation is here; **what to do about it is not**, because that is the
 * one part that genuinely differs — the CLI says to run `geode sync` again,
 * and a window with a Sync button in it should not be telling anyone to open a
 * terminal.
 */
export function deferralReason(s: SyncSummary): string | null {
  if (s.filesDeferred === 0) return null;
  const files = s.filesDeferred === 1 ? "file was" : "files were";
  return (
    `${s.filesDeferred} ${files} modified in the last couple of seconds ` +
    `and left alone, in case you have them open.`
  );
}

/**
 * What each sync phase is called.
 *
 * Shared for the same reason the rating words are: the phase is the only thing
 * that distinguishes a progress bar that is nearly finished from one that has
 * been pinned at the end of the file loop for a minute while `ingestLogs`
 * runs. Two interfaces inventing their own names would describe the same run
 * differently.
 */
export const PHASE_LABEL: Readonly<Record<SyncPhase, string>> = {
  scan: "reading notes",
  prune: "checking for removed cards",
  ingest: "reading review history",
};
