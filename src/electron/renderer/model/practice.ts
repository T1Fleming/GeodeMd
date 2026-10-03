/**
 * The Practice screen, as a pure function of state and action (ADR 0038).
 *
 * One solve per visit: the screen is handed the skill whose solve is most
 * overdue, times the attempt, shows the note when the user says they are
 * done, and records how it went. Nothing here reads the clock — `now` arrives
 * with each keypress, which is what makes `took` testable without waiting
 * half an hour — and the key table is `host`'s.
 */

import type { SolveReview } from "../../../core/index.js";
import { interpretPracticeKey } from "../../../host/present.js";

/**
 * - `solving` — the timer is running. Only `done` and `leave` mean anything:
 *   a rating before the solution is showing would grade an attempt nobody
 *   checked.
 * - `solved` — the note is showing (`note` is null until it has been read)
 *   and the clock has stopped at `took` seconds. A rating records it.
 * - `saving` — the rating is on its way.
 * - `done` — recorded. `next` is when the skill comes back, null when that
 *   could not be learned. No second solve is offered: the next one waits for
 *   the next visit.
 * - `left` — the user left without rating. Nothing was recorded, and the
 *   solve is still due.
 */
export type Practice =
  | { at: "solving"; review: SolveReview; startedAt: number }
  | { at: "solved"; review: SolveReview; took: number; note: string | null }
  | { at: "saving"; review: SolveReview; took: number; note: string | null; rating: 1 | 2 | 3 | 4 }
  | { at: "done"; review: SolveReview; rating: 1 | 2 | 3 | 4; next: string | null }
  | { at: "left" };

export type PracticeEffect =
  /** Read the exercise's note, to show once the clock stops; report through `noteArrived`. */
  | { kind: "read-note"; review: SolveReview }
  /** Record the solve; report through `recorded`. */
  | { kind: "rate"; review: SolveReview; rating: 1 | 2 | 3 | 4; took: number }
  | { kind: "open"; review: SolveReview };

/** The clock starts the moment the problem is on screen. */
export function start(review: SolveReview, now: Date): Practice {
  return { at: "solving", review, startedAt: now.getTime() };
}

/** Seconds on the clock at `now`, while solving; the stopped time after. */
export function elapsed(p: Practice, now: Date): number {
  if (p.at === "solving") return Math.max(0, (now.getTime() - p.startedAt) / 1000);
  if (p.at === "solved" || p.at === "saving") return p.took;
  return 0;
}

export function press(p: Practice, key: string, now: Date): { next: Practice; effect?: PracticeEffect } {
  const action = interpretPracticeKey(key);

  if (p.at === "solving") {
    if (action.kind === "leave") return { next: { at: "left" } };
    if (action.kind !== "done") return { next: p };
    return {
      next: { at: "solved", review: p.review, took: elapsed(p, now), note: null },
      effect: { kind: "read-note", review: p.review },
    };
  }

  if (p.at === "solved") {
    if (action.kind === "leave") return { next: { at: "left" } };
    if (action.kind === "open") return { next: p, effect: { kind: "open", review: p.review } };
    if (action.kind !== "rate") return { next: p };
    return {
      next: { ...p, at: "saving", rating: action.rating },
      effect: { kind: "rate", review: p.review, rating: action.rating, took: p.took },
    };
  }

  return { next: p };
}

/** The note arrived for the reveal; null when it could not be read. Dropped once past `solved`. */
export function noteArrived(p: Practice, text: string | null): Practice {
  if (p.at !== "solved") return p;
  return { ...p, note: text ?? "" };
}

/**
 * How the rating went: the skill's new due time, or null when it is not known.
 * A rating that failed outright goes back to `solved` with nothing lost, so it
 * can be given again; `failed` says which.
 */
export function recorded(p: Practice, next: string | null, failed = false): Practice {
  if (p.at !== "saving") return p;
  if (failed) return { at: "solved", review: p.review, took: p.took, note: p.note };
  return { at: "done", review: p.review, rating: p.rating, next };
}
