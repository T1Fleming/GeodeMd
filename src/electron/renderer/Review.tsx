/**
 * The review screen. Dumb on purpose: every decision is in `model/session.ts`,
 * which is why that file has thirteen tests and this one has none.
 */

import { useCallback, useEffect, useState } from "react";
import { ACTION_KEYS, RATING_KEYS } from "../../host/present.js";
import type { DueCard } from "../../core/index.js";
import { begin, current, isOver, press, reviewed } from "./model/session.js";
import type { Effect, Session } from "./model/session.js";

interface Props {
  queue: DueCard[];
  /** Total due, which is not the queue length — the queue is capped. */
  backlog: number;
  onRate: (cardId: string, rating: 1 | 2 | 3 | 4) => void;
  onOpen: (card: DueCard) => void;
  onDone: (session: Session) => void;
}

export function Review({ queue, backlog, onRate, onOpen, onDone }: Props): React.JSX.Element {
  const [session, setSession] = useState<Session>(() => begin(queue));

  const perform = useCallback(
    (effect: Effect | undefined) => {
      if (!effect) return;
      if (effect.kind === "rate") onRate(effect.cardId, effect.rating);
      else onOpen(effect.card);
    },
    [onRate, onOpen],
  );

  const handle = useCallback(
    (key: string) => {
      setSession((s) => {
        if (isOver(s)) return s;
        const { next, effect } = press(s, key);
        perform(effect);
        if (isOver(next)) onDone(next);
        return next;
      });
    },
    [perform, onDone],
  );

  useEffect(() => {
    // The whole screen is a keyboard surface, so the listener is on the
    // document rather than on a focused element — there is nothing sensible to
    // focus, and requiring a click before the keys work would be a bug.
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return; // leave shortcuts alone
      e.preventDefault();
      handle(e.key);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handle]);

  const card = current(session);

  if (isOver(session) || !card) {
    return <Finished session={session} />;
  }

  return (
    <main className="review">
      <header className="meta">
        <span>
          {session.at + 1} / {queue.length}
        </span>
        <span className="locator">{card.locator}</span>
        {backlog > queue.length && <span className="backlog">{backlog} due</span>}
      </header>

      <section className="card">
        <p className="question">{card.question}</p>
        {session.revealed ? (
          <p className="answer">{card.answer}</p>
        ) : (
          <p className="prompt">press any key to reveal</p>
        )}
      </section>

      <footer className="legend">
        {session.revealed ? (
          <>
            {RATING_KEYS.map(([key, label]) => (
              <button key={key} className="rating" onClick={() => handle(key)}>
                <kbd>{key}</kbd> {label}
              </button>
            ))}
            <span className="spacer" />
            {/* Mapped, not written out: ACTION_KEYS exists so the two
                interfaces cannot advertise different keys, and hand-writing
                one button here is exactly how that drifts. Dropping `q` is
                what the first version of this did. */}
            {ACTION_KEYS.map(([key, label]) => (
              <button key={key} className="action" onClick={() => handle(key)}>
                <kbd>{key}</kbd> {label}
              </button>
            ))}
          </>
        ) : (
          <span className="hint">
            <kbd>q</kbd> quit
          </span>
        )}
      </footer>
    </main>
  );
}

function Finished({ session }: { session: Session }): React.JSX.Element {
  const done = reviewed(session);
  const breakdown = RATING_KEYS.filter(([k]) => session.counts[Number(k) as 1 | 2 | 3 | 4] > 0);

  return (
    <main className="review done">
      <h2>
        {done} reviewed
        {session.quit && done < session.queue.length ? " — stopped early" : ""}
      </h2>
      {breakdown.length > 0 && (
        <ul className="breakdown">
          {breakdown.map(([k, label]) => (
            <li key={k}>
              {session.counts[Number(k) as 1 | 2 | 3 | 4]} {label}
            </li>
          ))}
        </ul>
      )}
      {session.opened.length > 0 && (
        // The queue holds text from the last sync, so a note edited during the
        // session is stale on screen and nothing else would say so.
        <p className="stale">
          You opened {session.opened.length === 1 ? session.opened[0] : `${session.opened.length} notes`}.
          Run <code>geode sync</code> to pick up any edits.
        </p>
      )}
    </main>
  );
}
