/**
 * The review session, as a pure function of state and action.
 *
 * No React, no IPC, no DOM — so it tests under plain vitest, and so the
 * decisions a session makes are separable from how they are drawn. This is the
 * same split the CLI already has (`render.ts` builds strings, `index.ts`
 * decides when to print), one interface further down.
 *
 * Neither the keyboard vocabulary nor the queue's rules are redefined here:
 * `interpretKey` and `RATING_KEYS` come from `host`, and so does the queue
 * itself (`host/queue.ts`), so this cannot drift from the CLI about what `3`
 * does, about whether `escape` quits, or about when a card comes back.
 *
 * What is left here is what a *screen* needs on top of a queue: whether the
 * answer is showing, what has been rated, which notes were opened.
 */

import type { DueCard } from "../../../core/index.js";
import { emptyCounts, interpretKey } from "../../../host/present.js";
import type { KeyAction, RatingCounts } from "../../../host/present.js";
import * as queue from "../../../host/queue.js";
import type { ReviewQueue, Scheduled } from "../../../host/queue.js";

export interface Session {
  queue: ReviewQueue;
  /**
   * The card on screen, or null when there is nothing to show yet.
   *
   * **Chosen when a key is pressed, never while drawing.** Which card is due
   * depends on the clock, and a component that asked "what now?" on every
   * render would swap the card out from under someone mid-read the moment a
   * learning card ripened. The clock is read on a keypress and the answer is
   * kept here (ADR 0023).
   *
   * Null is the narrow window where every remaining card has been rated and
   * the scheduler's answer has not come back: see `ReviewQueue.inFlight`. Not
   * the same as the session being over — ask `isOver`.
   */
  card: DueCard | null;
  /** The answer is hidden until asked for. */
  revealed: boolean;
  counts: RatingCounts;
  /** Set when the user quits early, to say so rather than imply completion. */
  quit: boolean;
  /**
   * Notes opened during the session, by relative path. Checked once at the
   * end rather than per card: only a terminal editor holds the process until
   * you quit it, so a GUI editor would report nothing if asked immediately.
   */
  opened: readonly string[];
}

/** Effects the caller performs. The session itself touches nothing. */
export type Effect =
  | { kind: "rate"; cardId: string; rating: 1 | 2 | 3 | 4 }
  | { kind: "open"; card: DueCard };

/**
 * No clock needed: every card in a fresh snapshot is due now by construction —
 * `getDueCards` returns what is due and what is new, and nothing else.
 */
export function begin(cards: readonly DueCard[]): Session {
  const q = queue.openQueue(cards);
  return {
    queue: q,
    card: cards[0] ?? null,
    revealed: false,
    counts: emptyCounts(),
    quit: false,
    opened: [],
  };
}

export function current(s: Session): DueCard | null {
  return s.card;
}

export function isOver(s: Session): boolean {
  return s.quit || queue.isEmpty(s.queue);
}

/** Cards answered so far. Not a position in the queue — a card can return. */
export function reviewed(s: Session): number {
  return s.counts[1] + s.counts[2] + s.counts[3] + s.counts[4];
}

/**
 * How many answers this sitting still owes, including the card on screen.
 *
 * The counter's denominator, and it **grows**: a card rated anything but easy
 * is owed again. `3 / 24` after `3 / 23` is not a bug, it is the second look
 * being earned.
 */
export function owed(s: Session): number {
  return queue.owed(s.queue);
}

/**
 * Apply a keypress.
 *
 * Mirrors the CLI's loop deliberately:
 *
 * - Any key reveals the answer, **except `q`**, which quits from the question
 *   too. A question you cannot escape without answering it is not what the
 *   legend promises.
 * - Rating before the answer is showing does nothing. The card is the question
 *   at that point, and recording a rating for an answer the user has not seen
 *   is worse than ignoring the key.
 * - `o` is offered only once the answer is showing, matching the CLI.
 * - `0` is the opposite: offered only *before* it is, because deferring a
 *   card whose answer you have read would make the next sighting a sham test.
 *   It records nothing at all.
 * - A rated card leaves the screen at once and comes back only if the
 *   scheduler says so, which the caller reports through `scheduled` — the
 *   session never guesses at an interval.
 */
export function press(s: Session, key: string, now: Date): { next: Session; effect?: Effect } {
  if (isOver(s)) return { next: s };
  const card = s.card;
  // Nothing on screen: every remaining card is in flight. A keypress in that
  // window is a key pressed at no card, and must not land on the next one.
  if (!card) return { next: s };

  const action: KeyAction = interpretKey(key);

  if (action.kind === "quit") return { next: { ...s, quit: true } };

  if (action.kind === "defer") {
    // Ignored once the answer is showing rather than treated as a reveal:
    // `0` means "I am not ready to answer this", which is only true while
    // the answer is still hidden.
    if (s.revealed) return { next: s };
    // No effect, and no counter. Nothing durable happens.
    const q = queue.setAside(s.queue, card);
    return { next: { ...s, queue: q, card: queue.serve(q, now) } };
  }

  if (!s.revealed) {
    // Any other key reveals, including a digit — which is why rating is only
    // honoured below, once `revealed` is already true.
    return { next: { ...s, revealed: true } };
  }

  if (action.kind === "rate") {
    const counts = { ...s.counts, [action.rating]: s.counts[action.rating] + 1 };
    const q = queue.rated(s.queue, card);
    return {
      next: { ...s, queue: q, card: queue.serve(q, now), revealed: false, counts },
      effect: { kind: "rate", cardId: card.id, rating: action.rating },
    };
  }

  if (action.kind === "open") {
    const opened = s.opened.includes(card.filePath) ? s.opened : [...s.opened, card.filePath];
    return { next: { ...s, opened }, effect: { kind: "open", card } };
  }

  return { next: s };
}

/**
 * The scheduler's answer for a card that was rated: when it is due, and in
 * what state. Null when the write failed and the new state is unknown.
 *
 * The caller reports this when `cardsReview` resolves, which is after the
 * keypress that caused it — the one place the session is driven by something
 * other than a key. Rating the last card is the case that makes it necessary:
 * the session cannot be over until this arrives, because the answer may be
 * "show it again in a minute".
 *
 * The card on screen is never replaced by this. A waiting card that ripens
 * while someone is reading takes its turn at the next keypress, not mid-read.
 */
export function scheduled(
  s: Session,
  cardId: string,
  next: Scheduled | null,
  now: Date,
): Session {
  const q = queue.scheduled(s.queue, cardId, next, now);
  return { ...s, queue: q, card: s.card ?? queue.serve(q, now) };
}
