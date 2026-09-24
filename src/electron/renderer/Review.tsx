/**
 * The review screen. Dumb on purpose: every decision is in `model/session.ts`,
 * which is why that file has thirty tests and this one has none.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { actionsAt, countText, RATING_KEYS } from "../../host/present.js";
import type { DueCard } from "../../core/index.js";
import { begin, current, isOver, owed, press, reviewed, scheduled } from "./model/session.js";
import type { Effect, Session } from "./model/session.js";
import type { Scheduled } from "../../host/queue.js";

interface Props {
  queue: DueCard[];
  /** Total due, which is not the queue length — the queue is capped. */
  backlog: number;
  /** True when `backlog` is a floor because a due count stopped at the cap. */
  backlogCapped: boolean;
  /**
   * Which opened notes were actually edited. Null while the answer is still
   * being fetched — the check is a stat of every opened file, so the finished
   * screen renders first and fills this in rather than waiting on it.
   */
  stale: string[] | null;
  /**
   * Record the rating, and answer with the card's new due time and state — or
   * null if that could not be learned. The session needs it to know whether
   * FSRS wants the card again in the same sitting (ADR 0023).
   */
  onRate: (cardId: string, rating: 1 | 2 | 3 | 4) => Promise<Scheduled | null>;
  onOpen: (card: DueCard) => void;
  onDone: (session: Session) => void;
  /**
   * Start another sitting, when the collection holds more than this one served.
   * Undefined when it does not, so the button is absent rather than disabled —
   * there is nothing to explain to someone who has finished everything.
   */
  onMore?: (() => void) | undefined;
}

export function Review({
  queue,
  backlog,
  backlogCapped,
  stale,
  onRate,
  onOpen,
  onDone,
  onMore,
}: Props): React.JSX.Element {
  const [session, setSession] = useState<Session>(() => begin(queue));

  /**
   * The session that transitions are computed from.
   *
   * A ref as well as state, and that is deliberate: a transition here has
   * *effects* — it writes a rating — and React's StrictMode invokes a
   * functional `setState` updater twice in development to catch exactly this
   * kind of impurity. Reading the current session from a ref keeps the updater
   * a plain `setSession(next)`, so a rating cannot be sent twice.
   */
  const live = useRef(session);
  /** `onDone` is worth saying once. Quitting and a last rating can both reach it. */
  const finished = useRef(false);

  const commit = useCallback(
    (next: Session) => {
      live.current = next;
      setSession(next);
      if (isOver(next) && !finished.current) {
        finished.current = true;
        onDone(next);
      }
    },
    [onDone],
  );

  const handle = useCallback(
    (key: string) => {
      const s = live.current;
      if (isOver(s)) return;
      const { next, effect } = press(s, key, new Date());
      commit(next);
      if (!effect) return;
      if (effect.kind === "open") return onOpen(effect.card);

      // The rating is recorded before its consequence is known: the card is in
      // flight until this resolves, and what comes back decides whether it
      // returns in ten minutes or not at all. Rating the *last* card is why
      // the session cannot simply end here.
      void onRate(effect.cardId, effect.rating).then((next) => {
        commit(scheduled(live.current, effect.cardId, next, new Date()));
      });
    },
    [commit, onOpen, onRate],
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

  if (isOver(session)) {
    return <Finished session={session} stale={stale} onMore={onMore} />;
  }

  // Nothing to show *yet*: the last card was rated and the scheduler's answer
  // is in flight. Milliseconds, and it must not be mistaken for a finished
  // session — a card may be about to come back.
  if (!card) return <p className="muted">saving…</p>;

  const done = reviewed(session);

  return (
    <main className="review">
      <header className="meta">
        {/* Answers, not cards: a learning card is owed a second one, so the
            denominator grows as those are earned. `host/queue.ts` counts it. */}
        <span>
          {done + 1} / {done + owed(session)}
        </span>
        <span className="locator">{card.locator}</span>
        {backlog > queue.length && (
          <span className="backlog">{countText(backlog, backlogCapped)} due</span>
        )}
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
  onMore,
}: {
  session: Session;
  stale: string[] | null;
  onMore?: (() => void) | undefined;
}): React.JSX.Element {
  const done = reviewed(session);
  const breakdown = RATING_KEYS.filter(([k]) => session.counts[Number(k) as 1 | 2 | 3 | 4] > 0);

  return (
    <main className="review done">
      <h2>
        {done} reviewed
        {/* Owed something and stopping anyway: that is stopping early,
            whether the cards were unseen or waiting on a learning step. */}
        {session.quit && owed(session) > 0 ? " — stopped early" : ""}
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
      {onMore && (
        <button className="primary more" onClick={onMore}>
          Review more
        </button>
      )}
      {stale !== null && stale.length > 0 && (
        <p className="stale">
          {stale.length === 1 ? <code>{stale[0]}</code> : `${stale.length} notes you opened`}{" "}
          changed while you were reviewing — <strong>sync</strong> to pick the changes up.
        </p>
      )}
    </main>
  );
}
