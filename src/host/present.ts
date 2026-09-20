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
