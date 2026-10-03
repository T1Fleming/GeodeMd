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

import type {
  DueCard,
  ReviewItem,
  Related,
  Rescheduled,
  SkillReview,
  SpotReview,
  SyncPhase,
  SyncSummary,
} from "../core/index.js";

/**
 * The four FSRS ratings, and what they are called. Spec section 9: the numbers
 * are not guessable, so the words travel with them everywhere they are shown.
 *
 * The number is FSRS's and is what the log records; the word is ours. `1` is
 * *forgot* rather than Anki's *again*, because it is the one failing rating
 * ([ADR 0036](../../docs/decisions/0036-rating-one-is-called-forgot.md)).
 */
export const RATING_KEYS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["1", "forgot"],
  ["2", "hard"],
  ["3", "good"],
  ["4", "easy"],
];

/**
 * The same four ratings for a **spot review**, worded as what happened rather
 * than how it felt ([ADR 0038](../../docs/decisions/0038-exercises.md)). The
 * numbers mean the same to FSRS; the words are what keep `1` from reading as
 * "forgot" when what happened is naming the wrong skill.
 */
export const SPOT_RATING_KEYS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["1", "wrong skill"],
  ["2", "right, after hesitating"],
  ["3", "right"],
  ["4", "right, at once"],
];

/**
 * The four ratings for a **solve**, on the Practice screen (ADR 0038). `1` and
 * `2` are things that observably happened — you finished or you did not, you
 * peeked or you did not. Between `3` and `4` is the user's judgement: there is
 * no time limit deciding it, and the time taken is logged as `took` so that
 * can be revisited with data.
 */
export const SOLVE_RATING_KEYS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["1", "couldn't solve it"],
  ["2", "solved with help"],
  ["3", "solved on my own"],
  ["4", "solved on my own, easily"],
];

/**
 * A key on the Practice screen. Its own table, because the screen has its own
 * stages: `solving` while the timer runs, `solved` once the note is showing.
 * `shown` is what the key is drawn as, for the one that is not a character.
 */
export interface PracticeKey {
  key: string;
  shown: string;
  label: string;
  stage: "solving" | "solved" | "both";
}

export const PRACTICE_KEYS: readonly PracticeKey[] = [
  // Space or Enter, never any key: half an hour in, a stray keypress must not
  // stop the clock and show the solution.
  { key: " ", shown: "space", label: "done — show the solution", stage: "solving" },
  { key: "o", shown: "o", label: "open in editor", stage: "solved" },
  // Leaving records nothing: the solve stays due, like `0 later` on a card.
  { key: "q", shown: "q", label: "leave", stage: "both" },
];

/** The Practice keys to advertise at one stage, in table order. */
export function practiceKeysAt(stage: "solving" | "solved"): PracticeKey[] {
  return PRACTICE_KEYS.filter((k) => k.stage === stage || k.stage === "both");
}

export type PracticeAction =
  | { kind: "done" }
  | { kind: "rate"; rating: 1 | 2 | 3 | 4 }
  | { kind: "open" }
  | { kind: "leave" }
  | { kind: "ignore" };

/** What a keypress means on the Practice screen. Which stage honours it is the model's. */
export function interpretPracticeKey(key: string): PracticeAction {
  if (key === " " || key === "Enter") return { kind: "done" };
  if (key >= "1" && key <= "4") return { kind: "rate", rating: Number(key) as 1 | 2 | 3 | 4 };
  if (key === "o" || key === "O") return { kind: "open" };
  if (key === "q" || key === "Q" || key === "Escape") return { kind: "leave" };
  return { kind: "ignore" };
}

/** A solve's time on the clock, `m:ss`, or `h:mm:ss` past the hour. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** When a skill comes back for a solve, said as a date: it is days out, never minutes. */
export function nextSolveText(skill: string, due: Date): string {
  const day = due.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  return `${skill} comes back for a solve on ${day}.`;
}

/**
 * The related exercises as lines to draw, in order: the rest of the pool of
 * the skill that came due, then each other skill and who shares it. Empty
 * when the exercise is alone everywhere.
 */
export function relatedLines(review: Pick<SkillReview, "skill"> & { related: Related }): Array<{ label: string; titles: string[] }> {
  const lines: Array<{ label: string; titles: string[] }> = [];
  if (review.related.pool.length > 0) {
    lines.push({ label: `Also in ${review.skill}`, titles: review.related.pool.map((e) => e.title) });
  }
  for (const other of review.related.others) {
    lines.push({ label: `Also tagged ${other.skill}, with`, titles: other.exercises.map((e) => e.title) });
  }
  return lines;
}

/** What a spot review asks, under the exercise's statement. */
export const SPOT_PROMPT = "Which skill does this call for?";

/**
 * What a spot review says when its skill had nothing fresh to serve: every
 * exercise in the pool has been asked for this skill, so this one is a repeat
 * and a weaker test (ADR 0038). The fix is the user's — another exercise.
 */
export function repeatText(skill: string): string {
  return `You have seen every exercise for ${skill}. Add one to its pool.`;
}

/**
 * True for a spot review. Here as well as in `core`, because this module is
 * in the renderer bundle and a value import from `core` would bring SQLite
 * with it; the type import above is free.
 */
export function isSpot(item: ReviewItem): item is SpotReview {
  return (item as SpotReview).kind === "spot";
}

/** The rating words for what is on screen. */
export function ratingKeysFor(item: ReviewItem): ReadonlyArray<readonly [key: string, label: string]> {
  return isSpot(item) ? SPOT_RATING_KEYS : RATING_KEYS;
}

/**
 * The line above the card naming where it lives, or null when nothing is to
 * be shown there yet.
 *
 * A spot review's is hidden until the answer is: the note's path can be the
 * answer — `monotonic-stack/daily-temperatures.md` — and a spot review shows
 * the title and the statement and nothing else (ADR 0038).
 */
export function locatorFor(item: ReviewItem, revealed: boolean): string | null {
  return isSpot(item) && !revealed ? null : item.locator;
}

/**
 * The start of the local day `now` falls in — what "served today" in the
 * serving rule is measured from (ADR 0038). Here and not in `core`, which
 * reads no timezone; `core` is handed the instant.
 */
export function startOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Where in a card a key is offered.
 *
 * A review card has two states — the question, and the question with its
 * answer showing — and until `defer` existed every key worth advertising
 * belonged to the second. Both interfaces therefore assumed the legend *was*
 * the answer's legend. Carrying the stage in the table is what lets each of
 * them draw the right keys at the right moment without either one deciding
 * for itself which those are.
 *
 * `note` is not a stage of the card but a place over it: the card's note,
 * shown inside the app (#51). Its keys are its own, and `both` does not reach
 * it — `q` there would end a session the user cannot see.
 */
export type KeyStage = "question" | "answer" | "both" | "note";

export interface ActionKey {
  key: string;
  label: string;
  stage: KeyStage;
  /**
   * Offered for cards only. An annotation is a file named by the card's
   * stamp, and a spot review has none to name it by (ADR 0038).
   */
  cardsOnly?: true;
}

/** Everything at the prompt that is not a rating. */
export const ACTION_KEYS: readonly ActionKey[] = [
  // `later` is offered ONLY at the question, and that is the whole design
  // rather than a limitation — see `interpretKey` below.
  { key: "0", label: "later", stage: "question" },
  { key: "o", label: "open", stage: "answer" },
  // `annotate` is offered ONLY at the answer: an annotation is free to restate
  // the answer, so showing one at the question would make the review a sham —
  // the mirror image of `later` (ADR 0029).
  { key: "a", label: "annotate", stage: "answer", cardsOnly: true },
  { key: "q", label: "quit", stage: "both" },
  // The note viewer's own keys (#51). The key that opened the note closes it,
  // and `e` is the one way on to an editor.
  { key: "o", label: "back to the card", stage: "note" },
  { key: "e", label: "open in editor", stage: "note" },
];

/**
 * The actions to advertise at one stage of a card, in table order. `spot` is
 * whether what is on screen is a spot review, which offers no annotation.
 */
export function actionsAt(stage: "question" | "answer" | "note", spot = false): ActionKey[] {
  return ACTION_KEYS.filter(
    (a) => (a.stage === stage || (a.stage === "both" && stage !== "note")) && !(spot && a.cardsOnly),
  );
}

export type KeyAction =
  | { kind: "quit" }
  | { kind: "rate"; rating: 1 | 2 | 3 | 4 }
  | { kind: "open" }
  /** Put this card back in the queue, unanswered. */
  | { kind: "defer" }
  /** Open the card's annotation for writing (ADR 0029). */
  | { kind: "annotate" }
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
  if (key === "a" || key === "A") return { kind: "annotate" };
  return { kind: "ignore" };
}

/**
 * What a keypress means while an annotation is open for writing.
 *
 * A different table from `interpretKey`, and deliberately a tiny one: while
 * the box is open **every key is text** — `3` is part of "3 seconds", not a
 * rating, and `q` is a letter, not a quit. The only exits are:
 *
 * - `Escape`, which **saves** and closes. It would quit the session anywhere
 *   else, and discarding typed text is the worse surprise of the two
 *   directions it could have gone (ADR 0029).
 * - Cmd+Enter (Ctrl+Enter off macOS), which saves and closes too.
 *
 * `command` is whether Cmd or Ctrl was held.
 */
export function interpretAnnotatingKey(key: string, command: boolean): { kind: "close" } | { kind: "type" } {
  if (key === "Escape" || key === "escape") return { kind: "close" };
  if (key === "Enter" && command) return { kind: "close" };
  return { kind: "type" };
}

/**
 * What a keypress means while a card's note is showing inside the app (#51).
 *
 * The third table, and as small as the annotation box's. **The review keys do
 * nothing here**: `3` must not rate a card hidden behind the note, and `q`
 * must not end the session from behind it. Two ways back to the card — `o`,
 * the key that opened the note, and `Escape` — and one way on: `e`, to the
 * editor that `o` opens when the viewer is not chosen.
 *
 * `ignore` is not "swallow". An arrow key or Page Down means nothing to the
 * session, which is exactly what lets it scroll the note.
 */
export function interpretViewingKey(
  key: string,
): { kind: "close" } | { kind: "editor" } | { kind: "ignore" } {
  if (key === "o" || key === "O" || key === "Escape" || key === "escape") return { kind: "close" };
  if (key === "e" || key === "E") return { kind: "editor" };
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
export function backlogCapped(counts: { dueNow: number; newCards: number; spotsDue?: number }): boolean {
  // Solves are not in the backlog: they are offered one at a time, by Practice.
  return counts.dueNow >= COUNT_CAP || counts.newCards >= COUNT_CAP || (counts.spotsDue ?? 0) >= COUNT_CAP;
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
 * A session's tally, cards then spot reviews, each in its own words: a spot
 * review rated `1` named the wrong skill, which is not "forgot" (ADR 0038).
 */
export function sessionBreakdown(cards: RatingCounts, spots: RatingCounts): Array<{ label: string; count: number }> {
  const spotLines = SPOT_RATING_KEYS.filter(([key]) => spots[Number(key) as 1 | 2 | 3 | 4] > 0).map(
    ([key, label]) => ({ label: `${label} (spot)`, count: spots[Number(key) as 1 | 2 | 3 | 4] }),
  );
  return [...ratingBreakdown(cards), ...spotLines];
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
    ["cardLinesUnnested", "card lines not nested"],
    // Only when there are any: a vault with no exercises should not be told so
    // on every sync (ADR 0038).
    ["exercisesFound", "exercises found"],
    ["exercisesUnreadable", "exercises with unreadable properties"],
    ["exercisesWithoutSolution", "exercises with no ## Solution"],
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
 * Why some card-shaped lines are not cards, and where, or null when there are
 * none.
 *
 * RemNote nests by indentation alone; Markdown nests only list items, and an
 * indented line under a line of text is more of that text. GeodeMD follows
 * Markdown, so these lines are skipped — said here, with the fix, because a
 * card that silently never appears looks like a bug in the reader's notes.
 */
export function unnestedReason(s: Pick<SyncSummary, "cardLinesUnnested" | "unnestedAt">): string | null {
  if (s.cardLinesUnnested === 0) return null;
  const one = s.cardLinesUnnested === 1;
  const more = s.cardLinesUnnested - s.unnestedAt.length;
  const where = s.unnestedAt.join(", ") + (more > 0 ? `, and ${more} more` : "");
  return one
    ? `1 line looks like a card but is indented without a list marker, so Markdown ` +
        `reads it as text, not as an outline: ${where}. Start it and its parent with "- " to nest it.`
    : `${s.cardLinesUnnested} lines look like cards but are indented without a list marker, ` +
        `so Markdown reads them as text, not as an outline: ${where}. ` +
        `Start them and their parents with "- " to nest them.`;
}

/**
 * Why an exercise was left out of every pool, or null when none was
 * (ADR 0038). Said with the fix, as `unnestedReason` is: a note that names its
 * skills and never comes up looks like a bug in the reader's notes.
 */
export function exerciseReason(
  s: Pick<SyncSummary, "exercisesUnreadable" | "exercisesWithoutSolution" | "exerciseProblemsAt">,
): string | null {
  const n = s.exercisesUnreadable + s.exercisesWithoutSolution;
  if (n === 0) return null;
  const more = n - s.exerciseProblemsAt.length;
  const where = s.exerciseProblemsAt.join(", ") + (more > 0 ? `, and ${more} more` : "");
  const subject = n === 1 ? "1 note names its skills but is not served" : `${n} notes name their skills but are not served`;
  return (
    `${subject}: ${where}. An exercise needs geode-skills to be a list, ` +
    `like [two-pointers, greedy], and a "## Solution" heading where its statement ends.`
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

/**
 * What to tell the user when opening a vault re-derived its schedules.
 *
 * Said at all because it changes what they see: due dates move, and a card
 * reviewed yesterday may be due today, or a card due today may be gone until
 * next week. A schedule that rearranges itself without a word reads as a bug,
 * or worse, as lost reviews — so the note says which of their things were
 * *not* touched, too ([ADR 0028](../../docs/decisions/0028-move-to-fsrs-6.md)).
 *
 * The scheduler's own version string is deliberately not shown: it is the
 * library and every parameter, and none of it is actionable.
 */
export function rescheduledText(r: Pick<Rescheduled, "cards">): string {
  const cards = r.cards === 1 ? "1 card" : `${r.cards.toLocaleString("en-US")} cards`;
  return (
    `The scheduler was updated, so due dates were worked out again for ${cards} ` +
    `from your review history. Some may have moved. Your notes and review log are unchanged.`
  );
}

/**
 * What to tell the user when the open vault's cards were found under older
 * card syntax ([ADR 0031](../../docs/decisions/0031-forward-cards-and-context.md)).
 *
 * Said before any sync, because the next one reads every note and may stamp
 * lines that were never cards before. The app also takes the user to the Sync
 * screen, where the preview is.
 */
export function syntaxChangedText(): string {
  return (
    "Card syntax changed: lines with >> or == are cards now, and lines with :: are not. " +
    "The next sync reads every note, so preview it first. Your review history is unchanged."
  );
}

/** Longest a path segment — the note's name or a heading — is shown before it is shortened. */
export const CRUMB_MAX = 40;

/** Between path segments. */
export const CRUMB_SEPARATOR = " › ";

/**
 * Between a line's question and its answer — on the card being asked, and on
 * a parent that is itself a card ([ADR 0037](../../docs/decisions/0037-mark-the-line-being-asked.md)).
 */
export const ANSWER_ARROW = " → ";

/**
 * What stands in for the answer on the line being asked, until the reveal puts
 * the answer in its place. In an outline whose parents are cards too, it is
 * what says which line the question is (ADR 0037).
 */
export const ANSWER_BLANK = "?";

/**
 * How many parent bullets are shown in full above a question. Older ones are
 * folded behind "… N more" until asked for: the nearest parent is the one that
 * gives a short question its meaning, and a deep outline would otherwise push
 * the question down the screen (ADR 0032).
 */
export const ANCESTORS_SHOWN = 3;

/** How many lines a parent bullet takes before it is cut, until it is clicked. */
export const ANCESTOR_LINES = 2;

/** A parent bullet as the outline above a question shows it. */
export interface Parent {
  text: string;
  answer?: string;
}

/** What to draw above a question. The renderer lays it out and decides nothing. */
export interface CardContext {
  /** The note's name, then its headings, each shortened to `CRUMB_MAX`. */
  path: string[];
  /** Parent bullets behind "… N more"; 0 when there are none, or once expanded. */
  folded: number;
  /** The parent bullets shown, outermost first, so the nearest is last. */
  parents: Parent[];
}

/**
 * The note and its headings as a path line, then the parent bullets as an
 * outline with the question as its last bullet — as RemNote shows a document
 * and the rems above a card (ADR 0032).
 *
 * **A parent whose text appears in the card's answer is left out at the
 * question**, and comes back with the answer: showing it first would give the
 * answer away. RemNote does the same. It is left out before folding, so the
 * parents shown are always the nearest ones that can be shown.
 */
export function cardContext(
  card: Pick<DueCard, "filePath" | "context" | "answer">,
  view: { revealed: boolean; expanded: boolean },
): CardContext {
  const file = card.filePath.slice(card.filePath.lastIndexOf("/") + 1);
  const note = file.replace(/\.(?:md|markdown)$/i, "");
  const headings = card.context.filter((c) => c.kind === "heading").map((c) => c.text);

  const answer = normalise(card.answer);
  const parents = card.context
    .filter((c) => c.kind === "item")
    .filter((c) => view.revealed || !spoils(normalise(c.text), answer))
    .map((c): Parent => (c.answer === undefined ? { text: c.text } : { text: c.text, answer: c.answer }));

  const folded = view.expanded ? 0 : Math.max(0, parents.length - ANCESTORS_SHOWN);
  return { path: [note, ...headings].map(shorten), folded, parents: parents.slice(folded) };
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function spoils(parent: string, answer: string): boolean {
  return parent !== "" && answer.includes(parent);
}

function shorten(text: string): string {
  const chars = [...text];
  return chars.length <= CRUMB_MAX ? text : `${chars.slice(0, CRUMB_MAX - 1).join("").trimEnd()}…`;
}

/**
 * What the finished screen says about cards a sitting still owes but cannot
 * show yet: they are on a learning step and not due (ADR 0033). A clock time
 * rather than a countdown, so the screen has nothing to redraw every second.
 */
export function restingText(cards: number, at: Date): string {
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return cards === 1 ? `1 card comes back at ${time}` : `${cards} cards come back at ${time}`;
}

/** What a review screen with no card on it offers once cards are due (#67). */
export function dueNowText(count: number, capped: boolean): string {
  return `${countText(count, capped)} due now`;
}

/** What each kind of long run is called on screen (ADR 0034 added `fresh`). */
export const RUN_LABEL: Readonly<Record<"sync" | "rebuild" | "fresh", string>> = {
  sync: "sync",
  rebuild: "rebuild",
  fresh: "fresh start",
};

/**
 * What erasing a vault would remove, in one sentence for the confirmation
 * (ADR 0035). Counts, so the user can weigh them before typing the name.
 */
export function erasePreviewText(p: {
  stamps: { files: number; stamps: number; unreadable: string[] };
  sr: { exists: boolean; logShards: number; annotations: number; archives: number };
}): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const notes =
    p.stamps.stamps === 0
      ? "No note holds an id comment"
      : `${n(p.stamps.stamps, "id comment", "id comments")} in ${n(p.stamps.files, "note", "notes")} will be taken out`;
  const sr = p.sr.exists
    ? `; .sr/ holds ${n(p.sr.logShards, "review log file", "review log files")}, ` +
      `${n(p.sr.annotations, "annotation", "annotations")} and ${n(p.sr.archives, "archived fresh start", "archived fresh starts")}`
    : "; there is no .sr/ folder";
  const unreadable =
    p.stamps.unreadable.length > 0
      ? `. ${n(p.stamps.unreadable.length, "note", "notes")} could not be read, so the erase will stop before deleting anything`
      : "";
  return `${notes}${sr}${unreadable}.`;
}
