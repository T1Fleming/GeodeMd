/**
 * A review screen with no card on it — finished, or "Nothing due" — checking
 * whether anything has come due since it was drawn (#67, ADR 0033).
 *
 * Pure, like `session.ts`: when to check, whether a check may start, and what
 * to offer are decisions, testable without a running app. The component holds
 * the timer and the IPC call and asks here what to do with them.
 *
 * A timer is allowed here and nowhere else in a review. The no-timer rule
 * exists so a card never changes under someone reading it (ADR 0023), and
 * these screens have no card. Even so, a check only ever *offers* a new sitting:
 * starting one by itself would wipe the finished screen's tally and its
 * "notes changed" warning before they were read.
 */

import { IDLE_RECHECK_MS } from "../../../host/queue.js";

/** What a due count found, ready for `dueNowText`. */
export interface Found {
  count: number;
  /** The count stopped at `COUNT_CAP`, so it is a floor (ADR 0024). */
  capped: boolean;
}

export interface Idle {
  /** A check is in flight; another must not start until it answers. */
  checking: boolean;
  /** Cards due now, to offer as a new sitting; null when there is nothing. */
  offer: Found | null;
  /** When the last check that answered began; null before one has. */
  checkedAt: number | null;
}

export const idle: Idle = { checking: false, offer: null, checkedAt: null };

/**
 * Begin a check, or null when one is already running. Focus, the timer and
 * the button can all fire together; one answer is enough.
 */
export function startCheck(v: Idle): Idle | null {
  return v.checking ? null : { ...v, checking: true };
}

/**
 * A check that began at `at` answered. Null means it failed, and the screen
 * stays as it was — an error on a screen that is only waiting would be noise.
 */
export function checked(v: Idle, found: Found | null, at: number): Idle {
  if (found === null) return { ...v, checking: false };
  return { checking: false, offer: found.count > 0 ? found : null, checkedAt: at };
}

/**
 * Whether the finished screen still says when its resting cards come back
 * (#73). It does until a check has run since that time: by then the check
 * has spoken for those cards, offering them as due now or finding them gone,
 * and "comes back at 12:06" beside "1 due now" is a time already past.
 *
 * Keyed to when a check ran rather than to the clock, so the line changes
 * when the offer does and not while someone is reading the screen. A failed
 * check leaves `checkedAt` alone, and with it the line.
 */
export function showsResting(v: Idle, restingAt: number): boolean {
  return v.checkedAt === null || v.checkedAt < restingAt;
}

/**
 * Slack after a known due time before checking, so the check does not ask a
 * moment before the card is due and find nothing.
 */
const AFTER_DUE_MS = 1_000;

/**
 * Milliseconds until the next check.
 *
 * When the screen knows a card's due time — the finished screen does, from the
 * cards it still owes — it wakes just after it, so a card due in a minute is
 * offered in a minute, not up to `IDLE_RECHECK_MS` later. Otherwise, and once
 * that time has passed, it checks every `IDLE_RECHECK_MS`, which is what finds
 * cards that come due without the screen knowing: tomorrow's reviews, or ones
 * from another device's log.
 */
export function nextCheckIn(now: number, nextDueAt: number | null): number {
  if (nextDueAt === null || nextDueAt <= now) return IDLE_RECHECK_MS;
  // Within the next regular check, wake just after the due time instead; a
  // regular check landing on the due time itself could miss it by a moment.
  const until = nextDueAt - now;
  return until <= IDLE_RECHECK_MS ? until + AFTER_DUE_MS : IDLE_RECHECK_MS;
}
