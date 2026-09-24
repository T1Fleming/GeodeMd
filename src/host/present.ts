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

/**
 * Where in a card a key is offered.
 *
 * A review card has two states — the question, and the question with its
 * answer showing — and until `defer` existed every key worth advertising
 * belonged to the second. Both interfaces therefore assumed the legend *was*
 * the answer's legend. Carrying the stage in the table is what lets each of
 * them draw the right keys at the right moment without either one deciding
 * for itself which those are.
 */
export type KeyStage = "question" | "answer" | "both";

export interface ActionKey {
  key: string;
  label: string;
  stage: KeyStage;
}

/** Everything at the prompt that is not a rating. */
export const ACTION_KEYS: readonly ActionKey[] = [
  // `later` is offered ONLY at the question, and that is the whole design
  // rather than a limitation — see `interpretKey` below.
  { key: "0", label: "later", stage: "question" },
  { key: "o", label: "open", stage: "answer" },
  { key: "q", label: "quit", stage: "both" },
];

/** The actions to advertise at one stage of a card, in table order. */
export function actionsAt(stage: "question" | "answer"): ActionKey[] {
  return ACTION_KEYS.filter((a) => a.stage === stage || a.stage === "both");
}

export type KeyAction =
  | { kind: "quit" }
  | { kind: "rate"; rating: 1 | 2 | 3 | 4 }
  | { kind: "open" }
  /** Put this card back in the queue, unanswered. */
  | { kind: "defer" }
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
  /**
   * `0` — "not now". The card goes back in the queue and **nothing is
   * recorded**: no log line, no FSRS fold, no database write.
   *
   * It is deliberately meaningless once the answer is showing, and that is
   * the point rather than an omission. Deferring a card you have already read
   * the answer to would poison the measurement — you would see it again with
   * the answer fresh, rate it well, and FSRS would record a clean success
   * over an interval you never actually waited. A card you could not recall
   * is a lapse, and `1` is the honest key for it.
   *
   * So this covers the one case a rating cannot: you are not ready to answer
   * yet. Interrupted, distracted, or wanting to give it proper attention
   * later. That is not a fact about your memory, so it is not recorded as one.
   */
  if (key === "0") return { kind: "defer" };
  return { kind: "ignore" };
}

/**
 * How far a count of a backlog goes before it stops and says "at least".
 *
 * A count of what is due costs a row probe per due card, and a count of what is
 * new costs an index entry each: at a million cards with a large backlog `stats`
 * measured 632 ms, which is two thirds of a second of frozen main process for
 * four numbers on a screen ([ADR 0024](../../docs/decisions/0024-remeasure-the-main-process-stall.md)).
 * Both counts are over sets whose size the user's own habits set, so the bound
 * is not an optimisation — it is the only thing that makes the cost knowable.
 *
 * Ten thousand because the exact size of a backlog stops being actionable long
 * before it: "10000+ due" and "38661 due" ask for the same thing, and the first
 * costs about 5 ms.
 *
 * It lives **here** rather than in `core` for two reasons that happen to agree.
 * It is a decision about what to show, which is what this module is for; and
 * `core` takes its policy as arguments — `stats(now, limit)` — which is what
 * keeps this file free of any runtime import from `core`. That matters more
 * than it looks: the renderer imports this module, and a value import from
 * `core` would pull `better-sqlite3` into a browser bundle. It did, once.
 */
export const COUNT_CAP = 10_000;

/**
 * A count that may have stopped early, as text.
 *
 * `stats` stops counting what is due at `COUNT_CAP` rather than freezing the
 * main process over a backlog (ADR 0024), which means a number that needs a
 * qualifier — and a qualifier is exactly the kind of thing two interfaces would
 * each invent for themselves. One of them would say `10000+`, the other
 * `over 10000`, and a screenshot from either would look right.
 *
 * A single count needs no flag: one that stopped early is exactly equal to the
 * cap, which is the default below. The flag is for the SUMS both interfaces
 * show — due-plus-new is a floor if either half is, and it can sit far above the
 * cap while neither of them did.
 */
export function countText(n: number, capped: boolean = n >= COUNT_CAP): string {
  return capped ? `${n}+` : String(n);
}

/**
 * Whether due-plus-new is a floor, for `countText`'s `capped` argument.
 *
 * `Counts.capped` is one flag OR'd across all three of `dueNow`,
 * `dueBeforeMidnight` and `newCards` — right for deciding whether *anything*
 * stopped early, wrong for a caller summing only two of the three. A backlog
 * a thousand cards over the cap on `dueBeforeMidnight` alone must not turn an
 * exact `dueNow + newCards` into a floor it never was.
 */
export function backlogCapped(counts: { dueNow: number; newCards: number }): boolean {
  return counts.dueNow >= COUNT_CAP || counts.newCards >= COUNT_CAP;
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
 * one part that genuinely differs — a terminal would say to run the command
 * again,
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
