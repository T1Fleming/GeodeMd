/**
 * The review screen. Dumb on purpose: every decision is in `model/session.ts`,
 * which is why that file has thirteen tests and this one has none.
 */

import { useCallback, useEffect, useState } from "react";
import { actionsAt, RATING_KEYS } from "../../host/present.js";
import type { DueCard } from "../../core/index.js";
import { begin, current, isOver, press, reviewed } from "./model/session.js";
import type { Effect, Session } from "./model/session.js";

interface Props {
  queue: DueCard[];
  /** Total due, which is not the queue length — the queue is capped. */
  backlog: number;
  /**
   * Which opened notes were actually edited. Null while the answer is still
   * being fetched — the check is a stat of every opened file, so the finished
   * screen renders first and fills this in rather than waiting on it.
   */
  stale: string[] | null;
  onRate: (cardId: string, rating: 1 | 2 | 3 | 4) => void;
  onOpen: (card: DueCard) => void;
  onDone: (session: Session) => void;
}

export function Review({
  queue,
  backlog,
  stale,
  onRate,
  onOpen,
  onDone,
}: Props): React.JSX.Element {
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
    return <Finished session={session} stale={stale} />;
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

      {/* Both stages are mapped from the same table, never written out.
          ACTION_KEYS exists so the two interfaces cannot advertise different
          keys — dropping `q` is what the first version of this did, and the
          hand-written `q quit` hint that used to sit at the question stage was
          the same mistake waiting to happen the moment a second key belonged
          there. Which keys belong to which stage is `host`'s to say. */}
      <footer className="legend">
        {session.revealed && (
          <>
            {RATING_KEYS.map(([key, label]) => (
              <button key={key} className="rating" onClick={() => handle(key)}>
                <kbd>{key}</kbd> {label}
              </button>
            ))}
            <span className="spacer" />
          </>
        )}
        {!session.revealed && <span className="spacer" />}
        {actionsAt(session.revealed ? "answer" : "question").map((a) => (
          <button key={a.key} className="action" onClick={() => handle(a.key)}>
            <kbd>{a.key}</kbd> {a.label}
          </button>
        ))}
      </footer>
    </main>
  );
}

function Finished({
  session,
  stale,
}: {
  session: Session;
  stale: string[] | null;
}): React.JSX.Element {
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
      {/* Which notes CHANGED, not which were opened. Opening a note to read it
          is the common case and needs no follow-up; only an edit does, because
          the queue holds text from the last sync and a rewritten card is stale
          in the database until the next one. Saying "you opened 3 notes, run
          sync" after three read-only glances trains the user to ignore it. */}
      {stale !== null && stale.length > 0 && (
        <p className="stale">
          {stale.length === 1 ? <code>{stale[0]}</code> : `${stale.length} notes you opened`}{" "}
          changed while you were reviewing — run <code>geode sync</code>.
        </p>
      )}
    </main>
  );
}
