/**
 * What a review session still owes an answer to, and which card to show next.
 *
 * Shared by both interfaces for the same reason the rating table is
 * ([ADR 0013](../../docs/decisions/0013-cli-and-electron-are-peers.md)): this
 * is a set of decisions — when a rated card comes back, whether it jumps ahead
 * of an unseen one, what happens when the only card left is due in forty
 * seconds — and two interfaces answering them differently would each stay
 * self-consistent while disagreeing about what a session *is*. Both would look
 * fine in isolation and no test would catch it. See
 * [ADR 0023](../../docs/decisions/0023-honour-short-term-learning-steps.md).
 *
 * Pure, and the clock is an argument. Nothing here reads `Date.now()`, opens a
 * file or knows what a terminal is, which is what lets the CLI's `while` loop
 * and the renderer's state machine drive the same rules.
 */

import type { DueCard } from "../core/index.js";
import { inShortTermSteps } from "../scheduler/index.js";

/**
 * As much of a card's new state as a session needs.
 *
 * Structural rather than `CardState`, because the two callers hold different
 * things: the CLI has `core.reviewCard`'s return value, the renderer has what
 * crossed the IPC boundary. Both satisfy this.
 */
export interface Scheduled {
  due: string;
  state: number;
}

/** A card that has been answered and is owed again later in this sitting. */
interface Waiting {
  card: DueCard;
  /** Epoch ms, from the scheduler's `due`. */
  dueAt: number;
}

export interface ReviewQueue {
  /** Not answered yet, in the order `getDueCards` returned them. */
  readonly fresh: readonly DueCard[];
  /** Answered, and due again inside this sitting. Earliest first. */
  readonly waiting: readonly Waiting[];
  /**
   * Answered, with the resulting due time not back yet.
   *
   * The reason this state exists at all: the renderer learns a card's new due
   * time from an IPC round trip that resolves *after* the keypress that caused
   * it. Without somewhere to put the card in between, a session whose last
   * card was just rated would look finished, end, and then be handed a card to
   * show. The CLI awaits `reviewCard` and passes through here in one step, but
   * it passes through the same states.
   */
  readonly inFlight: readonly DueCard[];
}

export function openQueue(cards: readonly DueCard[]): ReviewQueue {
  return { fresh: [...cards], waiting: [], inFlight: [] };
}

/**
 * How many answers the session still owes, including the card on screen.
 *
 * This is the number that grows: honouring the learning steps means a card
 * rated anything but *easy* is owed a second answer, so a 23-card queue is
 * ~46 answers. Both interfaces show it as the denominator of the counter,
 * which is why it counts *answers owed* rather than distinct cards — a card
 * you will see twice more is two.
 */
export function owed(q: ReviewQueue): number {
  return q.fresh.length + q.waiting.length + q.inFlight.length;
}

/** Nothing left to answer. Not the same as "nothing to show right now". */
export function isEmpty(q: ReviewQueue): boolean {
  return owed(q) === 0;
}

/**
 * Which card to show, at this instant.
 *
 * Three rules, in order:
 *
 * 1. **A waiting card whose time has come goes first.** It is genuinely due,
 *    and re-testing it ten minutes later is the entire point of the learning
 *    steps — holding it behind thirty unseen cards would defeat them.
 * 2. **Otherwise the next unseen card**, in the snapshot's order.
 * 3. **Otherwise the earliest waiting card, early.** Nothing else is left, so
 *    showing it now beats idling until it ripens: the session never waits, and
 *    no timer ever has to fire (ADR 0023).
 *
 * Returns null when there is nothing to show *yet* — every remaining card is
 * in flight. Ask `isEmpty` to tell that apart from a finished session.
 */
export function serve(q: ReviewQueue, now: Date): DueCard | null {
  const soonest = q.waiting[0];
  if (soonest && soonest.dueAt <= now.getTime()) return soonest.card;
  if (q.fresh.length > 0) return q.fresh[0]!;
  return soonest ? soonest.card : null;
}

/**
 * `0 later` — the card moves, and nothing is recorded (ADR 0022).
 *
 * It goes to the back of the unseen cards wherever it came from, which is what
 * "later" means with no rating to position it by. A waiting card deferred this
 * way loses its due time, and that is correct: it had already ripened, or it
 * would not have been on screen.
 *
 * Deferring the only *unseen* card returns it immediately rather than pulling a
 * waiting card early, even when one is a minute away. That is deliberate: the
 * back of the unseen cards is a place a card can always be served from, where
 * "behind everything, including the waiting cards" is not — a card that keeps
 * re-entering a learning step would keep being served early ahead of it, and a
 * deferred card could be starved for the rest of the session. `q` always works.
 */
export function setAside(q: ReviewQueue, card: DueCard): ReviewQueue {
  return {
    fresh: [...without(q.fresh, card.id), card],
    waiting: q.waiting.filter((w) => w.card.id !== card.id),
    inFlight: q.inFlight,
  };
}

/**
 * The card has been rated. Where it goes next is not known yet.
 *
 * Deliberately not "remove it": a rating that lands on a learning step is owed
 * again, and the session must not be able to declare itself over in the gap
 * before the scheduler's answer arrives.
 */
export function rated(q: ReviewQueue, card: DueCard): ReviewQueue {
  return {
    fresh: without(q.fresh, card.id),
    waiting: q.waiting.filter((w) => w.card.id !== card.id),
    inFlight: [...q.inFlight, card],
  };
}

/**
 * The scheduler's answer for a card that was rated: either a due time inside
 * this sitting, or graduation.
 *
 * `next` is null when the new state could not be learned — the database was
 * busy, or the write failed. The card is then dropped from the session rather
 * than guessed at: the rating itself is safe in the log by then, and the cost
 * of a busy database is one re-show, not one review.
 */
export function scheduled(
  q: ReviewQueue,
  cardId: string,
  next: Scheduled | null,
  now: Date,
): ReviewQueue {
  const card = q.inFlight.find((c) => c.id === cardId);
  if (!card) return q;
  const inFlight = without(q.inFlight, cardId);

  if (!next || !inShortTermSteps(next)) return { ...q, inFlight };

  // A `due` that will not parse would compare false against every clock and
  // become a card the session can neither show nor finish. Treated as due now:
  // the queue's job is to run out.
  const parsed = new Date(next.due).getTime();
  const dueAt = Number.isFinite(parsed) ? parsed : now.getTime();

  // Stable, so two cards due at the same instant keep the order they were
  // rated in rather than swapping between renders.
  const waiting = [...q.waiting, { card, dueAt }].sort((a, b) => a.dueAt - b.dueAt);
  return { fresh: q.fresh, waiting, inFlight };
}

function without(cards: readonly DueCard[], id: string): DueCard[] {
  return cards.filter((c) => c.id !== id);
}
