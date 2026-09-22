/**
 * The review session, as a pure function of state and action.
 *
 * No React, no IPC, no DOM — so it tests under plain vitest, and so the
 * decisions a session makes are separable from how they are drawn. This is the
 * same split the CLI already has (`render.ts` builds strings, `index.ts`
 * decides when to print), one interface further down.
 *
 * The keyboard vocabulary is NOT redefined here: `interpretKey` and
 * `RATING_KEYS` come from `host`, so this cannot drift from the CLI about what
 * `3` does or whether `escape` quits.
 */

import type { DueCard } from "../../../core/index.js";
import { emptyCounts, interpretKey } from "../../../host/present.js";
import type { KeyAction, RatingCounts } from "../../../host/present.js";

export interface Session {
  queue: readonly DueCard[];
  /** Index into `queue`. Equal to `queue.length` when the session is over. */
  at: number;
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

export function begin(queue: readonly DueCard[]): Session {
  return { queue, at: 0, revealed: false, counts: emptyCounts(), quit: false, opened: [] };
}

export function current(s: Session): DueCard | null {
  return s.at < s.queue.length ? s.queue[s.at]! : null;
}

export function isOver(s: Session): boolean {
  return s.quit || s.at >= s.queue.length;
}

/** Cards answered so far. Not `at`, which also advances on a quit. */
export function reviewed(s: Session): number {
  return s.counts[1] + s.counts[2] + s.counts[3] + s.counts[4];
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
 * - A card rated `1` does **not** come back in this session. The queue is a
 *   snapshot, and FSRS puts a lapsed card minutes out; re-queueing inside the
 *   session would be learning-steps logic, which is out of scope.
 */
export function press(s: Session, key: string): { next: Session; effect?: Effect } {
  if (isOver(s)) return { next: s };
  const action: KeyAction = interpretKey(key);
  const card = current(s)!;

  if (action.kind === "quit") return { next: { ...s, quit: true } };

  if (action.kind === "defer") {
    // Ignored once the answer is showing rather than treated as a reveal:
    // `0` means "I am not ready to answer this", which is only true while
    // the answer is still hidden.
    if (s.revealed) return { next: s };
    // No effect, and no counter. Nothing durable happens — the card simply
    // moves, and `at` stays put because the splice shifts the rest forward.
    return { next: { ...s, queue: moveToEnd(s.queue, s.at) } };
  }

  if (!s.revealed) {
    // Any other key reveals, including a digit — which is why rating is only
    // honoured below, once `revealed` is already true.
    return { next: { ...s, revealed: true } };
  }

  if (action.kind === "rate") {
    const counts = { ...s.counts, [action.rating]: s.counts[action.rating] + 1 };
    return {
      next: { ...s, at: s.at + 1, revealed: false, counts },
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
 * Move one card to the back of the queue.
 *
 * The queue's LENGTH is unchanged, which is what keeps `isOver` honest: a
 * deferred card is still owed an answer, so the session is not over until it
 * gets one or the user quits. `at` is deliberately not advanced — removing
 * the current card shifts the next one into its place.
 *
 * Deferring the only card left returns it immediately. That is the truthful
 * answer to "show me something else" when there is nothing else, and `q`
 * always works.
 */
function moveToEnd(queue: readonly DueCard[], at: number): DueCard[] {
  const next = [...queue];
  const [card] = next.splice(at, 1);
  if (card) next.push(card);
  return next;
}
