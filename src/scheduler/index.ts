/**
 * Spec section 7. One implementation, behind an interface, because it is four
 * lines and it is the one abstraction worth having up front.
 */

import { createEmptyCard, fsrs, generatorParameters, Rating, State, StrategyMode } from "ts-fsrs";
import type { AbstractScheduler, Card as FsrsCard, FSRSParameters } from "ts-fsrs";
import type { CardState } from "../store/index.js";

export type { CardState };

export interface Scheduler {
  /** State for a card that has never been reviewed. */
  initial(now: Date): CardState;
  /**
   * Next state given current state and a rating. `key` names what is being
   * scheduled — a card's id, or a skill and kind — and seeds the fuzz, so two
   * things rated alike at the same moment still part ways (ADR 0039).
   */
  next(state: CardState, rating: 1 | 2 | 3 | 4, now: Date, key: string): CardState;
  /**
   * What derived a state. Two schedulers with the same version must produce
   * the same state from the same history; `core` re-derives a database's
   * schedule when the recorded one differs (ADR 0028).
   */
  readonly version: string;
}

/**
 * Frozen. Section 10's rebuild test asserts that replaying a log reproduces
 * card_state exactly, which holds only if the scheduler is a pure function of
 * (history, params). Do not move these to config. Do not let them default.
 *
 * Two hazards are closed here and only one is obvious.
 *
 * `enable_fuzz` moves each interval of three days or more by a few percent,
 * so that things rated alike on the same day stop coming due on the same day
 * forever ([ADR 0039](../../docs/decisions/0039-exercises-after-first-use.md)).
 * It was off until then, because fuzz drawn from real randomness makes a
 * rebuild disagree with the run it rebuilt. It is drawn from `SEED_RECIPE`
 * instead: a pure function of the review, written here, so a rebuild — on
 * this machine or another — draws the same fuzz.
 *
 * The quieter hazard: FSRS's default weights are a fitted model the library
 * revises, so a minor bump would change what a rebuild produces from an
 * unchanged log. The vector is written out literally and the dependency is
 * pinned to an exact version, which makes that a change made on purpose.
 *
 * FSRS-6, and all 21 weights ([ADR 0028](../../docs/decisions/0028-move-to-fsrs-6.md)).
 * These are ts-fsrs 5.4.2's `default_w`. Handing `generatorParameters` a
 * 19-weight FSRS-5 vector would not fail: it pads it to 21 on its own, which
 * is FSRS-5 running on FSRS-6's engine — so the length is part of the pin.
 *
 * The learning steps are parameters in 5.x, and they are what ADR 0023's
 * same-sitting re-show is built on, so they are written out too — with
 * `enable_short_term`, which decides whether they apply at all.
 */
export const FSRS_PARAMS: FSRSParameters = generatorParameters({
  w: [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
    0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
  ],
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
});

/**
 * Frozen, for the same reasons: the parameters a **skill** is scheduled by
 * ([ADR 0038](../../docs/decisions/0038-exercises.md)).
 *
 * The weights are the cards' — nothing measured says a skill fades at another
 * rate. The difference is the short-term steps, which are off: they exist to
 * show a card again in one to ten minutes, and a problem re-solved a minute
 * after it was solved tests nothing but the minute.
 */
export const SKILL_FSRS_PARAMS: FSRSParameters = generatorParameters({
  w: [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
    0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
  ],
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: false,
  learning_steps: [],
  relearning_steps: [],
});

/**
 * The exact `ts-fsrs` this was measured against — the same string as the pin
 * in package.json, which `scheduler.test.ts` checks, so a bump cannot land
 * without changing it.
 */
export const TS_FSRS_VERSION = "5.4.2";

/**
 * Names the seed recipe (`seedFrom`, below), inside `versionOf`: changing the recipe changes
 * every fuzzed interval, so it must re-derive every schedule as a parameter
 * change does.
 */
export const SEED_RECIPE = "key|review-ms|reps";


/**
 * Which scheduler derived a database's `card_state`: the library and every
 * parameter, as one string.
 *
 * Recorded in the database and compared on open ([ADR 0028](../../docs/decisions/0028-move-to-fsrs-6.md)).
 * Built from the parameters rather than bumped by hand, so changing any of
 * them re-derives every schedule on the next launch without anyone having to
 * remember to — the failure mode of a hand-kept version number.
 */
export const SCHEDULER_VERSION = versionOf(FSRS_PARAMS);

/** Which scheduler derived `skill_state`, recorded and compared the same way. */
export const SKILL_SCHEDULER_VERSION = versionOf(SKILL_FSRS_PARAMS);

function versionOf(params: FSRSParameters): string {
  return `ts-fsrs@${TS_FSRS_VERSION} seed:${SEED_RECIPE} ${JSON.stringify(params)}`;
}

/** The key `next` was given, carried on the card into the library's scheduler. */
interface KeyedCard extends EngineCard {
  geode_key: string;
}

/**
 * The fuzz seed: what is scheduled, when it was rated to the millisecond, and
 * how many reviews it has had — integers and a string, nothing else.
 *
 * Not the library's default, for two reasons. The default is the library's
 * to revise, and a revision would quietly move every due date, the hazard
 * the weights are written out to close. And it mixes in difficulty times
 * stability: a float, so a last-digit difference between two machines' maths
 * would become a different seed, and a difference of days.
 */
function seedFrom(this: AbstractScheduler): string {
  const card = this.current as unknown as KeyedCard;
  return `${card.geode_key}|${this.review_time.getTime()}|${card.reps}`;
}

// `Rating.Again` is the library's name; the app calls it *forgot* (ADR 0036).
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
    learning_steps: card.learning_steps,
  };
}

/**
 * The card as the engine reads it — everything but `elapsed_days`.
 *
 * `elapsed_days` is deprecated in 5.x and removed in 6.0. The engine does not
 * read it on `next`: it computes the interval from `last_review` itself. This
 * type is what makes every *other* field a compile error to leave out, which
 * the old `as FsrsCard` on the whole literal did not — it let the new
 * `learning_steps` go missing without a word from `tsc`.
 */
type EngineCard = Omit<FsrsCard, "elapsed_days">;

function fromCardState(s: CardState): EngineCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    scheduled_days: 0,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as State,
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  };
}

export class FsrsScheduler implements Scheduler {
  private readonly engine: ReturnType<typeof fsrs>;
  readonly version: string;

  /** The cards' parameters unless told otherwise; `SKILL_FSRS_PARAMS` for skills. */
  constructor(params: FSRSParameters = FSRS_PARAMS) {
    this.engine = fsrs(params).useStrategy(StrategyMode.SEED, seedFrom);
    this.version = versionOf(params);
  }

  initial(now: Date): CardState {
    return toCardState(createEmptyCard(now));
  }

  next(state: CardState, rating: 1 | 2 | 3 | 4, now: Date, key: string): CardState {
    // The one cast left, and it is narrower than the one it replaced: it
    // admits only the missing `elapsed_days` (see `EngineCard`).
    const card: KeyedCard = { ...fromCardState(state), geode_key: key };
    const result = this.engine.next(card as unknown as FsrsCard, now, RATINGS[rating]);
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
  key: string,
  start: CardState | null,
  reviews: Array<{ rated_at: string; rating: number }>,
  fallbackNow: Date,
): CardState {
  let state = start ?? scheduler.initial(reviews[0] ? new Date(reviews[0].rated_at) : fallbackNow);
  for (const r of reviews) {
    state = scheduler.next(state, r.rating as 1 | 2 | 3 | 4, new Date(r.rated_at), key);
  }
  return state;
}

/**
 * Is the scheduler still walking this card through its short-term steps?
 *
 * The one FSRS fact a review session needs that is not a due date: a card in
 * `Learning` or `Relearning` has been given an interval measured in minutes
 * and is meant to be seen again in the same sitting, where a graduated card
 * has been given days and is not. It lives here because it is knowledge about
 * ts-fsrs's state machine — `host/queue.ts` decides what a session *does*
 * with the answer (ADR 0023), which is a different question.
 *
 * Deliberately a state test rather than "is `due` less than N minutes away":
 * the states are the scheduler's own instruction, where a minute threshold
 * would be ours. `queue.test.ts` pins the assumption that the two agree under
 * the parameters above.
 */
export function inShortTermSteps(state: Pick<CardState, "state">): boolean {
  return state.state === State.Learning || state.state === State.Relearning;
}
