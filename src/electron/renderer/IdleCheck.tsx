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
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { backlogCapped, dueNowText } from "../../host/present.js";
import { checked, idle, nextCheckIn, startCheck } from "./model/idle.js";
import type { Idle } from "./model/idle.js";

export function IdleCheck({
  nextDueAt,
  onReview,
}: {
  /** When a card this screen knows about is due, so it can wake just after. */
  nextDueAt: number | null;
  onReview: () => void;
}): React.JSX.Element {
  const [view, setView] = useState<Idle>(idle);
  const live = useRef(view);
  live.current = view;
  const [tick, setTick] = useState(0);

  const check = useCallback(async () => {
    const started = startCheck(live.current);
    if (!started) return;
    live.current = started;
    setView(started);
    const r = await window.geode.statsRead();
    const found = r.ok
      ? { count: r.value.dueNow + r.value.newCards, capped: backlogCapped(r.value) }
      : null;
    setView((v) => checked(v, found));
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
  );
}
