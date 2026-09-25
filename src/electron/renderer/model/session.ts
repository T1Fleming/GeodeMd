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
 * answer is showing, what has been rated, which notes were opened, and whether
 * the card's annotation is open for writing.
 */

import type { DueCard } from "../../../core/index.js";
import {
  emptyCounts,
  interpretAnnotatingKey,
  interpretKey,
  interpretViewingKey,
} from "../../../host/present.js";
import type { KeyAction, RatingCounts } from "../../../host/present.js";
import * as queue from "../../../host/queue.js";
import type { ReviewQueue, Scheduled } from "../../../host/queue.js";

/**
 * The card on screen's annotation, as far as this screen knows it (ADR 0029).
 *
 * - `unknown` — the answer is hidden, or the fetch made on reveal has not
 *   answered (or failed). `a` does nothing here, on purpose: opening an empty
 *   box over an annotation that has not arrived yet, and saving it, would
 *   overwrite the real one with whatever was typed.
 * - `closed` — known; `text` is null when the card has none. The marker shows
 *   when it is not.
 * - `open` — the box is showing and **every key is text** (`annotating`).
 *   `saving` while the write is in flight; `error` when it failed, in which
 *   case the box stays open with the draft in it — a failed save never drops
 *   what was typed.
 */
export type Annotation =
  | { at: "unknown" }
  | { at: "closed"; text: string | null }
  | { at: "open"; text: string | null; draft: string; saving: boolean; error: string | null };

const UNKNOWN: Annotation = { at: "unknown" };

/**
 * The card's note, shown inside the review window instead of an editor (#51).
 *
 * - `closed` — the card is on screen.
 * - `loading` — `o` was pressed and the read has not answered. The review
 *   keys are already off: a `3` pressed in that window must not rate a card
 *   the user has just asked to look past.
 * - `open` — the note is showing. `line` is where the card was found on disk,
 *   null when it was not; `stored` is where the last sync put it, which the
 *   viewer compares against to say so.
 *
 * `cardId` on both, so a slow read for a card that is no longer on screen is
 * dropped rather than shown over the next one.
 */
export type Viewer =
  | { at: "closed" }
  | { at: "loading"; cardId: string }
  | { at: "open"; cardId: string; text: string; line: number | null; stored: number | null };

const CLOSED: Viewer = { at: "closed" };

/**
 * What `o` does, fixed for the sitting: hand the note to an editor, or show it
 * here. Read from the config's `viewNotesInside` when the queue is drawn, so
 * choosing on the Vault screen applies from the next sitting — which is also
 * the next time the Review tab is opened. The viewer's `e` opens the editor
 * the config names either way.
 */
export type OpenIn = "editor" | "inside";

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
  /** The card on screen's annotation. See `Annotation`. */
  annotation: Annotation;
  /** What `o` does this sitting. See `OpenIn`. */
  openIn: OpenIn;
  /** The card's note, when it is showing inside the app. See `Viewer`. */
  viewer: Viewer;
}

/** Effects the caller performs. The session itself touches nothing. */
export type Effect =
  | { kind: "rate"; cardId: string; rating: 1 | 2 | 3 | 4 }
  | { kind: "open"; card: DueCard }
  /**
   * Find out whether the card just revealed has an annotation. A fetch on
   * reveal rather than a field on `DueCard`, so building the queue does not
   * cost a `stat` per card; the caller reports back through
   * `annotationFetched`.
   */
  | { kind: "fetch-annotation"; cardId: string }
  /** Write the annotation; the caller reports back through `annotationSaved`. */
  | { kind: "save-annotation"; cardId: string; text: string }
  /**
   * Read the card's note for the viewer; the caller reports back through
   * `noteRead`. Nothing is spawned and nothing is recorded as opened —
   * reading a note cannot change it.
   */
  | { kind: "read-note"; card: DueCard };

/**
 * No clock needed: every card in a fresh snapshot is due now by construction —
 * `getDueCards` returns what is due and what is new, and nothing else.
 */
export function begin(cards: readonly DueCard[], openIn: OpenIn = "editor"): Session {
  const q = queue.openQueue(cards);
  return {
    queue: q,
    card: cards[0] ?? null,
    revealed: false,
    counts: emptyCounts(),
    quit: false,
    opened: [],
    annotation: UNKNOWN,
    openIn,
    viewer: CLOSED,
  };
}

/**
 * Whether the card's note is showing, or on its way — the state in which the
 * review keys stop meaning anything and only the viewer's own do.
 */
export function viewing(s: Session): boolean {
  return s.viewer.at !== "closed";
}

/**
 * Whether the screen should let a keypress through to the page rather than
 * swallow it.
 *
 * Text typed into an open annotation (`keyIsText`), and, while the note is
 * showing, every key the viewer does not use — so the arrows, Space and Page
 * Down scroll the note. Either way the session has already decided the key
 * means nothing to it; this only says whether the page may have it.
 */
export function passesThrough(s: Session, key: string, command: boolean): boolean {
  if (viewing(s)) return interpretViewingKey(key).kind === "ignore";
  return keyIsText(s, key, command);
}

/**
 * Whether an annotation is open for writing — the state in which the review
 * keys stop meaning anything and every key belongs to the text box.
 */
export function annotating(s: Session): boolean {
  return s.annotation.at === "open";
}

/**
 * Whether a keypress belongs to the annotation box rather than to the review.
 *
 * The screen asks this before it swallows a key: while annotating, only the
 * keys that close the box are the session's, and everything else must reach
 * the text box untouched — `preventDefault` on it would mean typing nothing.
 */
export function keyIsText(s: Session, key: string, command: boolean): boolean {
  return annotating(s) && interpretAnnotatingKey(key, command).kind === "type";
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
 * - `a` opens the annotation, and only once the answer is showing (ADR 0029).
 *   At the question it does nothing at all — not even the reveal every other
 *   key performs, because someone reaching for their annotation must not be
 *   shown the answer they had not tried yet.
 * - **While annotating, nothing here applies.** No rating, no reveal, no
 *   quit, no defer, no open: the keys are text. Only `Escape` and
 *   Cmd+Enter mean anything, and both save and close (`closeAnnotation`).
 *   So `o` while annotating is text, and does not open the note.
 * - With the viewer chosen, `o` shows the card's note inside the app rather
 *   than spawning an editor (#51). **While it is showing, nothing above
 *   applies either**: `3` does not rate the card behind it, `q` does not quit,
 *   `a` does not open the annotation. `o` or `Escape` goes back to the card as
 *   it was, and `e` hands the note to an editor (`interpretViewingKey`). The
 *   viewer and the annotation box are never both open: each one's keys are
 *   checked before the other's can be reached.
 *
 * `command` is whether Cmd or Ctrl was held, which only the annotation box
 * reads.
 */
export function press(
  s: Session,
  key: string,
  now: Date,
  command = false,
): { next: Session; effect?: Effect } {
  if (isOver(s)) return { next: s };
  const card = s.card;
  // Nothing on screen: every remaining card is in flight. A keypress in that
  // window is a key pressed at no card, and must not land on the next one.
  if (!card) return { next: s };

  if (annotating(s)) {
    if (interpretAnnotatingKey(key, command).kind === "close") return closeAnnotation(s);
    return { next: s };
  }

  if (viewing(s)) {
    const v = interpretViewingKey(key);
    // Back to the card exactly as it was: same card, answer still showing,
    // annotation as it was left.
    if (v.kind === "close") return { next: { ...s, viewer: CLOSED } };
    if (v.kind === "editor") return openInEditor({ ...s, viewer: CLOSED }, card);
    return { next: s };
  }

  const action: KeyAction = interpretKey(key);

  if (action.kind === "quit") return { next: { ...s, quit: true } };

  if (action.kind === "annotate") {
    // Ignored at the question rather than treated as a reveal — see above.
    if (!s.revealed) return { next: s };
    // Ignored until the annotation is known, so a box can never open empty
    // over text that has not arrived yet.
    if (s.annotation.at !== "closed") return { next: s };
    const text = s.annotation.text;
    return {
      next: {
        ...s,
        annotation: { at: "open", text, draft: text ?? "", saving: false, error: null },
      },
    };
  }

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
    // honoured below, once `revealed` is already true. Revealing is also when
    // the card's annotation is asked about, for the marker.
    return {
      next: { ...s, revealed: true, annotation: UNKNOWN },
      effect: { kind: "fetch-annotation", cardId: card.id },
    };
  }

  if (action.kind === "rate") {
    const counts = { ...s.counts, [action.rating]: s.counts[action.rating] + 1 };
    const q = queue.rated(s.queue, card);
    return {
      next: {
        ...s,
        queue: q,
        card: queue.serve(q, now),
        revealed: false,
        counts,
        annotation: UNKNOWN,
      },
      effect: { kind: "rate", cardId: card.id, rating: action.rating },
    };
  }

  if (action.kind === "open") {
    if (s.openIn === "inside") {
      return {
        next: { ...s, viewer: { at: "loading", cardId: card.id } },
        effect: { kind: "read-note", card },
      };
    }
    return openInEditor(s, card);
  }

  return { next: s };
}

/** Hand the card's note to an editor, and remember it for the end-of-session check. */
function openInEditor(s: Session, card: DueCard): { next: Session; effect: Effect } {
  const opened = s.opened.includes(card.filePath) ? s.opened : [...s.opened, card.filePath];
  return { next: { ...s, opened }, effect: { kind: "open", card } };
}

/**
 * The answer to a `read-note` effect: the note's text and the line the card
 * was found on, or null when the read failed — which closes the viewer and
 * leaves the card as it was, the same way a failed `open` leaves it.
 *
 * Dropped unless the viewer is still waiting for this card: `Escape` pressed
 * before a slow read answered means the user has gone back to the card, and
 * the note must not open over it afterwards.
 */
export function noteRead(
  s: Session,
  cardId: string,
  note: { text: string; line: number | null } | null,
): Session {
  const v = s.viewer;
  if (v.at !== "loading" || v.cardId !== cardId) return s;
  if (note === null) return { ...s, viewer: CLOSED };
  return {
    ...s,
    viewer: { at: "open", cardId, text: note.text, line: note.line, stored: s.card?.lineNo ?? null },
  };
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

/**
 * The answer to a `fetch-annotation` effect: the card's annotation text, or
 * null when it has none. Dropped unless that card is still the one on screen
 * with its answer showing — a slow answer for a card already rated must not
 * land on the next one.
 */
export function annotationFetched(s: Session, cardId: string, text: string | null): Session {
  if (s.card?.id !== cardId || !s.revealed || s.annotation.at !== "unknown") return s;
  return { ...s, annotation: { at: "closed", text } };
}

/** The text box changed. Ignored while a save is in flight. */
export function editAnnotation(s: Session, draft: string): Session {
  const a = s.annotation;
  if (a.at !== "open" || a.saving) return s;
  return { ...s, annotation: { ...a, draft } };
}

/**
 * Close the annotation, **saving** what was typed — what `Escape`, Cmd+Enter
 * and the Save button all do (ADR 0029).
 *
 * An unchanged draft closes without a write: rewriting the same bytes would
 * touch the file's mtime for nothing, and a file syncer treats that as an
 * edit. Otherwise the box stays open, marked `saving`, until
 * `annotationSaved` reports how the write went.
 */
export function closeAnnotation(s: Session): { next: Session; effect?: Effect } {
  const a = s.annotation;
  if (a.at !== "open" || a.saving || !s.card) return { next: s };
  if (a.draft === (a.text ?? "") || (a.text === null && a.draft.trim() === "")) {
    return { next: { ...s, annotation: { at: "closed", text: a.text } } };
  }
  return {
    next: { ...s, annotation: { ...a, saving: true, error: null } },
    effect: { kind: "save-annotation", cardId: s.card.id, text: a.draft },
  };
}

/**
 * Whether the screen may be left for another vault — true once no
 * annotation is open.
 *
 * A vault switch saves an open box first (`closeAnnotation`), waits for
 * `annotationSaved`, and asks this. A save that failed leaves the box open
 * with its error and the draft, so this stays false and **the switch does not
 * happen**: going ahead would unmount the box and lose the text, which is the
 * one thing a failed save must never do (ADR 0029).
 */
export function mayLeave(s: Session): boolean {
  return !annotating(s);
}

/**
 * How a `save-annotation` went: null for success, or the reason it failed.
 *
 * Success closes the box, and blank text leaves the card with no annotation
 * — the file is removed rather than left empty. **Failure keeps the box open
 * with the draft in it** and says why: dropping text the user typed because a
 * disk said no is the one outcome this must never have.
 */
export function annotationSaved(s: Session, cardId: string, error: string | null): Session {
  const a = s.annotation;
  if (s.card?.id !== cardId || a.at !== "open" || !a.saving) return s;
  if (error !== null) return { ...s, annotation: { ...a, saving: false, error } };
  const text = a.draft.trim() === "" ? null : a.draft;
  return { ...s, annotation: { at: "closed", text } };
}
