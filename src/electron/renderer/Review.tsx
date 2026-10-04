/**
 * The review screen. Dumb on purpose: every decision is in `model/session.ts`,
 * which is why that file has thirty tests and this one has none.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  actionsAt,
  ANCESTOR_LINES,
  ANSWER_ARROW,
  ANSWER_BLANK,
  cardContext,
  countText,
  CRUMB_SEPARATOR,
  isSpot,
  locatorFor,
  ratingKeysFor,
  relatedLines,
  sessionBreakdown,
  repeatText,
  restingText,
  rateSkillText,
  ratingOrder,
  SPOT_RATING_KEYS,
  spotPrompt,
} from "../../host/present.js";
import { IdleCheck } from "./IdleCheck.js";
import { cardLineNote } from "../../host/note.js";
import type { DueCard, ReviewItem, SpotReview } from "../../core/index.js";
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
  resting,
  mayLeave,
  noteRead,
  owed,
  passesThrough,
  press,
  reviewed,
  scheduled,
  viewing,
} from "./model/session.js";
import type { Annotation, Effect, OpenIn, Session, Viewer } from "./model/session.js";
import type { Scheduled } from "../../host/queue.js";
import type { NoteText, Result } from "../ipc.js";
import { linkTarget, renderNote } from "./note.js";

interface Props {
  queue: ReviewItem[];
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
  onRate: (
    item: ReviewItem,
    rating: 1 | 2 | 3 | 4,
    others?: Array<{ skill: string; rating: 1 | 2 | 3 | 4 }>,
  ) => Promise<Scheduled | null>;
  onOpen: (card: ReviewItem) => void;
  /** What `o` does this sitting: an editor, or the viewer here (#51). */
  openIn: OpenIn;
  /** A card's note as it is on disk, for the viewer. */
  onNoteRead: (card: ReviewItem) => Promise<Result<NoteText>>;
  /** A card's annotation, asked for when it is revealed (ADR 0029). */
  onAnnotationRead: (cardId: string) => Promise<Result<string | null>>;
  /** Write one. A failure keeps the text in the box, with the reason beside it. */
  onAnnotationWrite: (cardId: string, text: string) => Promise<Result<void>>;
  /** A quiet note, for what cannot be shown in the panel. */
  onNote: (message: string) => void;
  onDone: (session: Session) => void;
  /**
   * Hand the shell a way to save an open annotation before it switches vault.
   * Called with null when this screen goes away.
   */
  onRegisterFlush?: ((flush: (() => Promise<boolean>) | null) => void) | undefined;
  /**
   * Start another sitting, when the collection holds more than this one served.
   * Undefined when it does not, so the button is absent rather than disabled —
   * there is nothing to explain to someone who has finished everything.
   */
  onMore?: (() => void) | undefined;
  /**
   * Start a new sitting from what is due now. Offered by the finished screen
   * once a card comes due — one this sitting is owed but would not show early,
   * or one due anyway (#67, ADR 0033).
   */
  onAgain: () => void;
}

export function Review({
  queue,
  backlog,
  backlogCapped,
  stale,
  onRate,
  onOpen,
  openIn,
  onNoteRead,
  onAnnotationRead,
  onAnnotationWrite,
  onNote,
  onDone,
  onRegisterFlush,
  onMore,
  onAgain,
}: Props): React.JSX.Element {
  const [session, setSession] = useState<Session>(() => begin(queue, openIn));

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
  /** The annotation save in flight, if any — what `flush` waits on. */
  const inFlight = useRef<Promise<void> | null>(null);

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

      if (effect.kind === "read-note") {
        void onNoteRead(effect.card).then((r) => {
          // A failed read goes back to the card with a quiet note, the same
          // treatment a failed `open` gets: the session survives it.
          if (!r.ok) onNote(`could not show the note: ${r.message}`);
          commit(noteRead(live.current, effect.card.id, r.ok ? r.value : null));
        });
        return;
      }

      if (effect.kind === "save-annotation") {
        // Kept, so a vault switch can wait for a save already under way.
        const done = onAnnotationWrite(effect.cardId, effect.text).then((r) => {
          commit(annotationSaved(live.current, effect.cardId, r.ok ? null : r.message));
        });
        inFlight.current = done;
        void done.finally(() => {
          if (inFlight.current === done) inFlight.current = null;
        });
        return;
      }

      // The rating is recorded before its consequence is known: the card is in
      // flight until this resolves, and what comes back decides whether it
      // returns in ten minutes or not at all. Rating the *last* card is why
      // the session cannot simply end here.
      void onRate(effect.item, effect.rating, effect.others).then((next) => {
        commit(scheduled(live.current, effect.cardId, next, new Date()));
      });
    },
    [commit, onOpen, onRate, onNoteRead, onAnnotationRead, onAnnotationWrite, onNote],
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
      // Over the note, a key the viewer does not use is the page's — the
      // arrows, Space and Page Down scroll it. The session ignores them all
      // the same; this only decides whether the page may have them.
      if (viewing(live.current) && passesThrough(live.current, e.key, command)) return;
      e.preventDefault();
      handle(e.key);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handle]);

  /**
   * Save an open annotation and wait for it, answering whether the screen may
   * now be left for another vault (`mayLeave`). The vault switcher calls this
   * BEFORE switching, so the save lands in the vault the text was written in;
   * a failed save answers false, the box stays open with its error, and the
   * switch does not happen (ADR 0029).
   */
  const flush = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current;
    const { next, effect } = closeAnnotation(live.current);
    commit(next);
    perform(effect);
    if (inFlight.current) await inFlight.current;
    return mayLeave(live.current);
  }, [commit, perform]);

  useEffect(() => {
    if (!onRegisterFlush) return;
    onRegisterFlush(flush);
    return () => onRegisterFlush(null);
  }, [flush, onRegisterFlush]);

  /**
   * Leaving the screen with the box open saves it, as Escape would. Switching
   * tab unmounts this component, and losing typed text to a tab click is the
   * surprise the whole close-saves rule exists to avoid.
   *
   * A vault switch never gets here with the box open — it flushes first. This
   * is for a tab change, and main's refusal of a write naming a vault no
   * longer open stays behind it as a backstop.
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
    return <Finished session={session} stale={stale} onMore={onMore} onAgain={onAgain} />;
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
        {/* A spot review's path can name its skill, so it waits for the reveal. */}
        <span className="locator">{locatorFor(card, session.revealed) ?? ""}</span>
        {backlog > queue.length && (
          <span className="backlog">{countText(backlog, backlogCapped)} due</span>
        )}
      </header>

      {viewing(session) ? (
        <NoteViewer viewer={session.viewer} onKey={handle} />
      ) : (
        <>
          <section className="card">
            {/* Keyed by card, so what was expanded for one card is not
                expanded for the next. */}
            {isSpot(card) ? (
              <SpotFront key={card.id} spot={card} revealed={session.revealed} given={session.skillRatings} />
            ) : (
              <Front key={card.id} card={card} revealed={session.revealed} />
            )}
            {/* The answer itself is drawn in place of the `?`, by `Front`. */}
            {!session.revealed && <p className="prompt">press any key to reveal</p>}
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
              <div className="ratings">
                {ratingKeysFor(card).map(([key, label]) => (
                  <button
                    key={key}
                    className="rating"
                    disabled={annotating(session)}
                    onClick={() => handle(key)}
                  >
                    <kbd>{key}</kbd> {label}
                  </button>
                ))}
              </div>
            )}
            <div className="actions">
              {actionsAt(session.revealed ? "answer" : "question", isSpot(card)).map((a) => (
                <button
                  key={a.key}
                  className="action"
                  disabled={annotating(session)}
                  onClick={() => handle(a.key)}
                >
                  <kbd>{a.key}</kbd> {a.label}
                </button>
              ))}
            </div>
          </footer>
        </>
      )}
    </main>
  );
}

/**
 * The card's note, in place of the card (#51). Read-only. Every decision —
 * which keys work here, what `o` and `Escape` go back to — is in
 * `model/session.ts`; the Markdown it renders is `host/note.ts`'s, sanitised
 * in `note.ts`.
 */
function NoteViewer({
  viewer,
  onKey,
}: {
  viewer: Viewer;
  onKey: (key: string) => void;
}): React.JSX.Element {
  const body = useRef<HTMLElement>(null);
  const open = viewer.at === "open" ? viewer : null;
  const rendered = useMemo(() => (open ? renderNote(open.text, open.line) : null), [open]);
  // A spot review's note is shown whole: there is no line to have moved.
  const where = open && !open.whole ? cardLineNote(open.stored, open.line) : null;

  // Focused so the arrows and Page Down scroll the note rather than the
  // window, and scrolled so the card's line is in the middle of it.
  useEffect(() => {
    if (!rendered || !body.current) return;
    body.current.focus({ preventScroll: true });
    document.getElementById(rendered.markerId)?.scrollIntoView({ block: "center" });
  }, [rendered]);

  /**
   * Links in a note: only http(s), and only through `link/open`. Everything
   * is intercepted here, so no link in a note ever navigates the window — and
   * main refuses navigation as well, should one get past.
   */
  const onClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    e.preventDefault();
    const href = linkTarget(anchor.getAttribute("href"));
    if (href) void window.geode.linkOpen(href);
  }, []);

  return (
    <>
      <section className="viewer">
        {/* The note's path is already in the bar above, as the locator. */}
        {where !== null && <p className="viewer-moved">{where}</p>}
        {rendered ? (
          <article
            ref={body}
            className="note doc"
            tabIndex={-1}
            onClick={onClick}
            // Sanitised in `renderNote`: a note is user content, unlike the
            // bundled docs Help renders this way.
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
        ) : (
          <p className="muted">reading the note…</p>
        )}
      </section>
      <footer className="legend">
        <div className="actions">
          {actionsAt("note").map((a) => (
            <button key={a.key} className="action" onClick={() => onKey(a.key)}>
              <kbd>{a.key}</kbd> {a.label}
            </button>
          ))}
        </div>
      </footer>
    </>
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
  onAgain,
}: {
  session: Session;
  stale: string[] | null;
  onMore?: (() => void) | undefined;
  onAgain: () => void;
}): React.JSX.Element {
  const done = reviewed(session);
  const waiting = resting(session);
  const breakdown = sessionBreakdown(session.counts, session.spotCounts);

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
          {breakdown.map(({ label, count }) => (
            <li key={label}>
              {count} {label}
            </li>
          ))}
        </ul>
      )}
      {/* Which notes CHANGED, not which were opened. Opening a note to read it
          is the common case and needs no follow-up; only an edit does, because
          the queue holds text from the last sync and a rewritten card is stale
          in the database until the next one. Saying "you opened 3 notes, run
          sync" after three read-only glances trains the user to ignore it. */}
      {/* Owed, but not due: shown when due, not before (ADR 0033). */}
      {onMore ? (
        <>
          {waiting && <p className="resting">{restingText(waiting.cards, new Date(waiting.at))}</p>}
          <button className="primary more" onClick={onMore}>
            Review more
          </button>
        </>
      ) : (
        // More is due than this sitting held, so "Review more" already covers
        // it; otherwise watch for cards coming due (#67), and say when the
        // owed ones come back until a check finds they have (#73).
        <IdleCheck resting={waiting} onReview={onAgain} />
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

/**
 * The question, under the note's path and the outline of its parent bullets,
 * as RemNote draws a card (ADR 0032). What is shown — which parents, how many,
 * which are spoilers — is `host`'s `cardContext`; this lays it out and keeps
 * the two things a click can change.
 *
 * Shown at both stages: the parents are what make a short question
 * answerable. A spoiler parent appears once the answer does, and so does the
 * answer itself, where the `?` was.
 */
function Front({ card, revealed }: { card: DueCard; revealed: boolean }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [unclamped, setUnclamped] = useState<ReadonlySet<string>>(new Set());
  const shown = cardContext(card, { revealed, expanded });
  const depth = shown.parents.length;
  const indent = (level: number) => ({ marginLeft: `${level * 1.25}rem` });

  return (
    <div className="front">
      <p className="crumbs">{shown.path.join(CRUMB_SEPARATOR)}</p>
      {shown.folded > 0 && (
        <button className="fold" onClick={() => setExpanded(true)}>
          … {shown.folded} more
        </button>
      )}
      {depth > 0 && (
        <ul className="parents">
          {shown.parents.map((p, level) => {
            const id = `${p.text}\u0000${p.answer ?? ""}`;
            const clamped = !unclamped.has(id);
            return (
              <li
                key={level}
                className={clamped ? "parent clamped" : "parent"}
                style={{ ...indent(level), WebkitLineClamp: clamped ? ANCESTOR_LINES : "unset" }}
                onClick={() => setUnclamped((s) => new Set(s).add(id))}
              >
                {p.text}
                {p.answer !== undefined && <span className="parent-answer">{ANSWER_ARROW}{p.answer}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {/* The line being asked ends in a `?`, and the answer takes its place on
          the reveal — so a revealed card reads like its parents (ADR 0037).
          `.question` stays on the question alone: it is the same text at
          both stages. */}
      <p className={depth > 0 ? "card-line bulleted" : "card-line"} style={depth > 0 ? indent(depth) : undefined}>
        <span className="question">{card.question}</span>
        {revealed ? (
          <>
            <span className="arrow">{ANSWER_ARROW}</span>
            <span className="answer">{card.answer}</span>
          </>
        ) : (
          // One unbreakable run, so a long question cannot strand the `?`
          // alone on the next line.
          <span className="tail">
            <span className="arrow">{ANSWER_ARROW}</span>
            <span className="blank" aria-label="answer hidden">
              {ANSWER_BLANK}
            </span>
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * A spot review: the exercise's title and statement, and the question, with
 * nothing above them — no path, no skills — because the skill is the answer
 * (ADR 0038). The reveal names every skill the exercise has, in the order
 * they are rated, and each is rated on its own (ADR 0040): the one the keys
 * rate next is marked, and those already rated show their rating. The
 * statement is a note's Markdown, rendered and sanitised as the viewer renders
 * a note.
 */
function SpotFront({
  spot,
  revealed,
  given,
}: {
  spot: SpotReview;
  revealed: boolean;
  given: ReadonlyArray<{ skill: string; rating: 1 | 2 | 3 | 4 }>;
}): React.JSX.Element {
  const order = ratingOrder(spot);
  const which = rateSkillText(order[given.length] ?? "", given.length, order.length);
  const statement = useMemo(() => renderNote(spot.statement, null).html, [spot.statement]);
  return (
    <div className="front spot">
      <h3 className="spot-title">{spot.title}</h3>
      <article
        className="note doc spot-statement"
        // Sanitised in `renderNote`, like the viewer's note.
        dangerouslySetInnerHTML={{ __html: statement }}
      />
      <p className="card-line">
        <span className="question">{spotPrompt(spot.skills.length)}</span>
        {revealed ? (
          <>
            <span className="arrow">{ANSWER_ARROW}</span>
            <span className="answer">
              {order.map((skill, i) => (
                <span key={skill} className={order.length > 1 && i === given.length ? "skill current" : "skill"}>
                  {i > 0 && " · "}
                  {skill}
                  {given[i] && <span className="muted"> ({SPOT_RATING_KEYS[given[i]!.rating - 1]![1]})</span>}
                </span>
              ))}
            </span>
          </>
        ) : (
          <span className="tail">
            <span className="arrow">{ANSWER_ARROW}</span>
            <span className="blank" aria-label="answer hidden">
              {ANSWER_BLANK}
            </span>
          </span>
        )}
      </p>
      {revealed && which && <p className="rate-which">{which}</p>}
      {revealed && spot.repeat && (
        <p className="spot-repeat">{repeatText(spot.skill)}</p>
      )}
      {/* After the reveal only: the rest of the pool would hint at the skill. */}
      {revealed && relatedLines(spot).length > 0 && (
        <ul className="related">
          {relatedLines(spot).map((line) => (
            <li key={line.label}>
              <span className="muted">{line.label}:</span> {line.titles.join(" · ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
