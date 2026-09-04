/**
 * Spec section 7. One implementation, behind an interface, because it is four
 * lines and it is the one abstraction worth having up front.
 */

import { createEmptyCard, fsrs, generatorParameters, Rating, State } from "ts-fsrs";
import type { Card as FsrsCard, FSRSParameters } from "ts-fsrs";
import type { CardState } from "../store/index.js";

export type { CardState };

export interface Scheduler {
  /** State for a card that has never been reviewed. */
  initial(now: Date): CardState;
  /** Next state given current state and a rating. */
  next(state: CardState, rating: 1 | 2 | 3 | 4, now: Date): CardState;
}

/**
 * Frozen. Section 10's rebuild test asserts that replaying a log reproduces
 * card_state exactly, which holds only if the scheduler is a pure function of
 * (history, params). Do not move these to config. Do not let them default.
 *
 * Two hazards are closed here and only one is obvious.
 *
 * `enable_fuzz` randomizes each interval by a few percent; with it on, a
 * rebuild produces a different `due` than the run it rebuilt and the rebuild
 * test fails intermittently — the worst way for a test to fail. The library's
 * current default was confirmed to be false rather than assumed; the point of
 * writing it down is that the default is not ours to rely on.
 *
 * The quieter hazard: FSRS's default weights are a fitted model the library
 * revises, so a minor bump would change what a rebuild produces from an
 * unchanged log. The vector is written out literally and the dependency is
 * pinned to an exact version, which makes that a change made on purpose.
 */
export const FSRS_PARAMS: FSRSParameters = generatorParameters({
  w: [
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
    1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
  ],
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
});

const RATINGS = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
} as const;

function toCardState(card: FsrsCard): CardState {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

function fromCardState(s: CardState): FsrsCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as State,
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  } as FsrsCard;
}

export class FsrsScheduler implements Scheduler {
  private readonly engine = fsrs(FSRS_PARAMS);

  initial(now: Date): CardState {
    return toCardState(createEmptyCard(now));
  }

  next(state: CardState, rating: 1 | 2 | 3 | 4, now: Date): CardState {
    const result = this.engine.next(fromCardState(state), now, RATINGS[rating]);
    return toCardState(result.card);
  }
}

/**
 * Replay a chronological run of ratings onto a starting state.
 *
 * Section 8 step 7 keeps two rules apart that are easy to confuse:
 *   - WHICH cards to replay is decided by what actually inserted, never by
 *     comparing timestamps.
 *   - HOW to replay a given card is a free choice, because this is a pure fold.
 * This function is the fold; the caller decides where to start it.
 */
export function fold(
  scheduler: Scheduler,
  start: CardState | null,
  reviews: Array<{ rated_at: string; rating: number }>,
  fallbackNow: Date,
): CardState {
  let state = start ?? scheduler.initial(reviews[0] ? new Date(reviews[0].rated_at) : fallbackNow);
  for (const r of reviews) {
    state = scheduler.next(state, r.rating as 1 | 2 | 3 | 4, new Date(r.rated_at));
  }
  return state;
}
