/**
 * The review screen. Dumb on purpose: every decision is in `model/session.ts`,
 * which is why that file has thirty tests and this one has none.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { actionsAt, countText, RATING_KEYS } from "../../host/present.js";
import type { DueCard } from "../../core/index.js";
import {
  annotating,
  annotationFetched,
  annotationSaved,
  begin,
  closeAnnotation,
  current,
  editAnnotation,
  isOver,
  keyIsText,
  owed,
  press,
  reviewed,
  scheduled,
} from "./model/session.js";
import type { Annotation, Effect, Session } from "./model/session.js";
import type { Scheduled } from "../../host/queue.js";
import type { Result } from "../ipc.js";

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
  /** A card's annotation, asked for when it is revealed (ADR 0029). */
  onAnnotationRead: (cardId: string) => Promise<Result<string | null>>;
  /** Write one. A failure keeps the text in the box, with the reason beside it. */
  onAnnotationWrite: (cardId: string, text: string) => Promise<Result<void>>;
  /** A quiet note, for what cannot be shown in the panel. */
  onNote: (message: string) => void;
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
  onAnnotationRead,
  onAnnotationWrite,
  onNote,
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

  const perform = useCallback(
    (effect: Effect | undefined) => {
      if (!effect) return;
      if (effect.kind === "open") return onOpen(effect.card);

      if (effect.kind === "fetch-annotation") {
        void onAnnotationRead(effect.cardId).then((r) => {
          // A failed read leaves the annotation unknown, and `a` stays inert:
          // opening an empty box over text that could not be read, and saving
          // it, would overwrite the real annotation.
          if (!r.ok) return onNote(`could not read this card's annotation: ${r.message}`);
          commit(annotationFetched(live.current, effect.cardId, r.value));
        });
        return;
      }

      if (effect.kind === "save-annotation") {
        void onAnnotationWrite(effect.cardId, effect.text).then((r) => {
          commit(annotationSaved(live.current, effect.cardId, r.ok ? null : r.message));
        });
        return;
      }

      // The rating is recorded before its consequence is known: the card is in
      // flight until this resolves, and what comes back decides whether it
      // returns in ten minutes or not at all. Rating the *last* card is why
      // the session cannot simply end here.
      void onRate(effect.cardId, effect.rating).then((next) => {
        commit(scheduled(live.current, effect.cardId, next, new Date()));
      });
    },
    [commit, onOpen, onRate, onAnnotationRead, onAnnotationWrite, onNote],
  );

  const handle = useCallback(
    (key: string, command = false) => {
      const s = live.current;
      if (isOver(s)) return;
      const { next, effect } = press(s, key, new Date(), command);
      commit(next);
      perform(effect);
    },
    [commit, perform],
  );

  /** The Save button: the same close-and-save as Escape and Cmd+Enter. */
  const save = useCallback(() => {
    const { next, effect } = closeAnnotation(live.current);
    commit(next);
    perform(effect);
  }, [commit, perform]);

  const edit = useCallback((draft: string) => commit(editAnnotation(live.current, draft)), [commit]);

  useEffect(() => {
    // The whole screen is a keyboard surface, so the listener is on the
    // document rather than on a focused element — there is nothing sensible to
    // focus, and requiring a click before the keys work would be a bug.
    //
    // Except while annotating. Then every key is text, and swallowing it here
    // would mean the box receives nothing — so only the keys that close the
    // box are taken, and the session model says which those are.
    const onKey = (e: KeyboardEvent): void => {
      const command = e.metaKey || e.ctrlKey;
      if (annotating(live.current)) {
        // An input method's own Escape cancels its composition, not the box.
        if (e.isComposing || keyIsText(live.current, e.key, command)) return;
        e.preventDefault();
        handle(e.key, command);
        return;
      }
      if (command || e.altKey) return; // leave shortcuts alone
      e.preventDefault();
      handle(e.key);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handle]);

  /**
   * Leaving the screen with the box open saves it, as Escape would. Switching
   * tab unmounts this component, and losing typed text to a tab click is the
   * surprise the whole close-saves rule exists to avoid. After a vault switch
   * main refuses the write rather than filing it in the wrong vault, and the
   * note says so.
   */
  const leaving = useRef({ onAnnotationWrite, onNote });
  leaving.current = { onAnnotationWrite, onNote };
  useEffect(
    () => () => {
      const { effect } = closeAnnotation(live.current);
      if (effect?.kind !== "save-annotation") return;
      const { onAnnotationWrite: write, onNote: note } = leaving.current;
      void write(effect.cardId, effect.text).then((r) => {
        if (!r.ok) note(`annotation not saved: ${r.message}`);
      });
    },
    [],
  );

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
        {/* Only ever after the reveal — an annotation may restate the answer
            (ADR 0029). A marker when there is one, never the text itself
            until asked for. */}
        {session.revealed && <AnnotationView annotation={session.annotation} onEdit={edit} onSave={save} />}
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
              <button
                key={key}
                className="rating"
                disabled={annotating(session)}
                onClick={() => handle(key)}
              >
                <kbd>{key}</kbd> {label}
              </button>
            ))}
            <span className="spacer" />
          </>
        )}
        {!session.revealed && <span className="spacer" />}
        {actionsAt(session.revealed ? "answer" : "question").map((a) => (
          <button
            key={a.key}
            className="action"
            disabled={annotating(session)}
            onClick={() => handle(a.key)}
          >
            <kbd>{a.key}</kbd> {a.label}
          </button>
        ))}
      </footer>
    </main>
  );
}

/**
 * The annotation under a revealed answer: nothing, a marker, or the box.
 * Every decision about it is in `model/session.ts`; this only draws.
 */
function AnnotationView({
  annotation,
  onEdit,
  onSave,
}: {
  annotation: Annotation;
  onEdit: (draft: string) => void;
  onSave: () => void;
}): React.JSX.Element | null {
  const box = useRef<HTMLTextAreaElement>(null);
  const open = annotation.at === "open";

  // Focus the box as it opens, with the caret after the existing text — the
  // usual reason to open it is to add a line.
  useEffect(() => {
    const el = box.current;
    if (!open || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [open]);

  if (annotation.at === "unknown") return null;
  if (annotation.at === "closed") {
    return annotation.text === null ? null : (
      <p className="annotation-marker">
        <kbd>a</kbd> this card has an annotation
      </p>
    );
  }

  return (
    <div className="annotation">
      <textarea
        ref={box}
        value={annotation.draft}
        readOnly={annotation.saving}
        rows={4}
        placeholder="A mnemonic, a source, why you mix it up with another card…"
        onChange={(e) => onEdit(e.target.value)}
      />
      <div className="annotation-bar">
        {annotation.error !== null && (
          <span className="annotation-error">not saved — {annotation.error}</span>
        )}
        <span className="spacer" />
        <span className="hint">
          <kbd>esc</kbd> or <kbd>⌘↵</kbd> saves and closes
        </span>
        <button className="save" disabled={annotation.saving} onClick={onSave}>
          {annotation.saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
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
