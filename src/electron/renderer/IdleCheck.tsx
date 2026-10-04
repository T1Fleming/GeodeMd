/**
 * On a review screen with no card on it, notice when cards come due and offer
 * them (#67, ADR 0033).
 *
 * Dumb in the way `Sync.tsx` is: when to check, whether a check may start and
 * what to offer are `model/idle.ts`'s; the words are `host/present.ts`'s. What
 * is left here is the timer, the focus listener and one IPC call.
 *
 * It only ever offers. Starting a sitting by itself would replace the finished
 * screen's tally and its "notes changed" warning before anyone read them.
 *
 * It also draws the finished screen's "comes back at" line, because a check is
 * what makes that line out of date (#73): the two have to share one state, or
 * the screen says a card comes back at a time already past beside "1 due now".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { backlogCapped, dueNowText, restingText } from "../../host/present.js";
import { checked, idle, nextCheckIn, showsResting, startCheck } from "./model/idle.js";
import type { Idle } from "./model/idle.js";

export function IdleCheck({
  resting,
  onReview,
}: {
  /**
   * Cards the sitting still owes, and when the first is due, so the screen can
   * say so and wake just after. Null on "Nothing due", which knows no due time.
   */
  resting: { cards: number; at: number } | null;
  onReview: () => void;
}): React.JSX.Element {
  const nextDueAt = resting?.at ?? null;
  const [view, setView] = useState<Idle>(idle);
  const live = useRef(view);
  live.current = view;
  const [tick, setTick] = useState(0);

  const check = useCallback(async () => {
    const started = startCheck(live.current);
    if (!started) return;
    live.current = started;
    setView(started);
    // The clock at the edge, when the check begins: the count it gets back is
    // as of now or later, never earlier.
    const at = Date.now();
    const r = await window.geode.statsRead();
    const found = r.ok
      ? { count: r.value.dueNow + r.value.newCards, capped: backlogCapped(r.value) }
      : null;
    setView((v) => checked(v, found, at));
    // Re-arm the timer from this moment, whatever started the check.
    setTick((n) => n + 1);
  }, []);

  // On mount, and whenever the window comes back to the front.
  useEffect(() => {
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check]);

  // The next timed check. Cleared on unmount, so leaving the tab or switching
  // vault leaves nothing running.
  useEffect(() => {
    const id = window.setTimeout(() => void check(), nextCheckIn(Date.now(), nextDueAt));
    return () => window.clearTimeout(id);
  }, [check, nextDueAt, tick]);

  return (
    <>
      {resting && showsResting(view, resting.at) && (
        <p className="resting">{restingText(resting.cards, new Date(resting.at))}</p>
      )}
      <div className="idle-check">
        {view.offer ? (
          <>
            <p className="due-now">{dueNowText(view.offer.count, view.offer.capped)}</p>
            <button className="primary review-due" onClick={onReview}>
              Review
            </button>
          </>
        ) : (
          <button className="quiet check-again" disabled={view.checking} onClick={() => void check()}>
            Check again
          </button>
        )}
      </div>
    </>
  );
}
