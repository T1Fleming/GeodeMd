/**
 * The Practice screen, as a pure function of state and action (ADR 0038).
 *
 * One solve per visit: the screen is handed the skill whose solve is most
 * overdue, times the attempt while the user has the clock running, shows the
 * note when they say they are done, and records how it went. Nothing here reads the clock — `now` arrives
 * with each keypress, which is what makes `took` testable without waiting
 * half an hour — and the key table is `host`'s.
 */

import type { SolveReview } from "../../../core/index.js";
import { interpretPracticeKey, ratingOrder } from "../../../host/present.js";

/**
 * - `solving` — the problem is showing. The clock counts only while it runs:
 *   `ranMs` is what it has counted so far, and `since` when it last started,
 *   null while it is not started or paused. Space starts and pauses it; `d`
 *   finishes, from any of the three. A rating before the solution is showing
 *   would grade an attempt nobody checked, so ratings mean nothing here.
 * - `solved` — the note is showing (`note` is null until it has been read)
 *   and the clock has stopped at `took` seconds — null when it never started,
 *   which is "not timed", not "instant" (#81). A rating records it.
 * - `saving` — the rating is on its way.
 * - `done` — recorded. `next` is when the skill comes back, null when that
 *   could not be learned. No second solve is offered: the next one waits for
 *   the next visit.
 * - `left` — the user left without rating. Nothing was recorded, and the
 *   solve is still due.
 */
export type Practice =
  | { at: "solving"; review: SolveReview; ranMs: number; since: number | null }
  | {
      at: "solved";
      review: SolveReview;
      took: number | null;
      note: string | null;
      /** Ratings so far, one per skill in `ratingOrder` (ADR 0040). Absent before the first. */
      given?: ReadonlyArray<{ skill: string; rating: 1 | 2 | 3 | 4 }>;
    }
  | { at: "saving"; review: SolveReview; took: number | null; note: string | null; rating: 1 | 2 | 3 | 4 }
  | { at: "done"; review: SolveReview; rating: 1 | 2 | 3 | 4; next: string | null }
  | { at: "left" };

export type PracticeEffect =
  /** Read the exercise's note, to show once the clock stops; report through `noteArrived`. */
  | { kind: "read-note"; review: SolveReview }
  /** Record the solve; report through `recorded`. */
  | {
      kind: "rate";
      review: SolveReview;
      rating: 1 | 2 | 3 | 4;
      took: number | null;
      /** The exercise's other skills, each with its own rating (ADR 0040). */
      others?: Array<{ skill: string; rating: 1 | 2 | 3 | 4 }>;
    }
  | { kind: "open"; review: SolveReview }
  /** Hide or show the clock: a view setting, kept by the screen. */
  | { kind: "clock" };

/**
 * Whether coming back to the tab picks this solve up again rather than
 * offering a new one. A solve under way survives a visit to another tab, with
 * its clock still running from the offer (#81); a finished or abandoned one
 * does not, which is what "one solve per visit" means.
 */
export function resumable(p: Practice | null): p is Practice & { at: "solving" | "solved" | "saving" } {
  return p !== null && (p.at === "solving" || p.at === "solved" || p.at === "saving");
}

/**
 * The problem is on screen and the clock has not started. It used to start
 * here, which counted reading time, a solve left open overnight, and in
 * testing a day-long leap of the clock as solving (#81).
 */
export function start(review: SolveReview): Practice {
  return { at: "solving", review, ranMs: 0, since: null };
}

/** Where the clock is: not started, running, or paused. Null once solving is over. */
export function clockState(p: Practice): "not-started" | "running" | "paused" | null {
  if (p.at !== "solving") return null;
  if (p.since !== null) return "running";
  return p.ranMs === 0 ? "not-started" : "paused";
}

/** Seconds on the clock at `now`, while solving; the stopped time after. */
export function elapsed(p: Practice, now: Date): number {
  if (p.at === "solving") return Math.max(0, (p.ranMs + (p.since === null ? 0 : now.getTime() - p.since)) / 1000);
  if (p.at === "solved" || p.at === "saving") return p.took ?? 0;
  return 0;
}

export function press(p: Practice, key: string, now: Date): { next: Practice; effect?: PracticeEffect } {
  const action = interpretPracticeKey(key);

  if (action.kind === "clock" && (p.at === "solving" || p.at === "solved")) return { next: p, effect: { kind: "clock" } };

  if (p.at === "solving") {
    if (action.kind === "leave") return { next: { at: "left" } };
    if (action.kind === "toggle") {
      const t = now.getTime();
      return p.since === null
        ? { next: { ...p, since: t } }
        : { next: { ...p, ranMs: p.ranMs + (t - p.since), since: null } };
    }
    if (action.kind !== "done") return { next: p };
    return {
      next: { at: "solved", review: p.review, took: clockState(p) === "not-started" ? null : elapsed(p, now), note: null },
      effect: { kind: "read-note", review: p.review },
    };
  }

  if (p.at === "solved") {
    if (action.kind === "leave") return { next: { at: "left" } };
    if (action.kind === "open") return { next: p, effect: { kind: "open", review: p.review } };
    if (action.kind !== "rate") return { next: p };
    // Each skill the exercise names is rated in turn (ADR 0040); every key but
    // the last only takes note, and nothing is sent until all are given.
    const order = ratingOrder(p.review);
    const given = [...(p.given ?? []), { skill: order[(p.given ?? []).length]!, rating: action.rating }];
    if (given.length < order.length) return { next: { ...p, given } };
    const others = given.slice(1);
    const { given: _done, ...solved } = p;
    return {
      next: { ...solved, at: "saving", rating: given[0]!.rating },
      effect: {
        kind: "rate",
        review: p.review,
        rating: given[0]!.rating,
        took: p.took,
        ...(others.length > 0 ? { others } : {}),
      },
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
