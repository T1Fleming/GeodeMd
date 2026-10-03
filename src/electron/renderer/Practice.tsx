/**
 * The Practice screen: one solve per visit (ADR 0038). Dumb on purpose, like
 * the review screen: every decision is in `model/practice.ts`, the words and
 * keys are `host`'s.
 *
 * The one timer in the app that redraws every second is here, and it is safe
 * for the reason `IdleCheck`'s is: nothing it draws changes *what* is on
 * screen. The problem was chosen when the screen opened; the clock is only a
 * number beside it, and the time recorded is read on the keypress.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ANSWER_ARROW,
  clockStateText,
  clockText,
  interpretPracticeKey,
  nextSolveText,
  practiceKeysAt,
  rateSkillText,
  ratingOrder,
  relatedLines,
  repeatText,
  startPauseLabel,
  SOLVE_RATING_KEYS,
} from "../../host/present.js";
import type { SolveReview } from "../../core/index.js";
import { clockState, elapsed, noteArrived, press, recorded, resumable, start } from "./model/practice.js";
import type { Practice as Model, PracticeEffect } from "./model/practice.js";
import { renderNote } from "./note.js";

/**
 * A solve held by the app rather than the screen, so that it outlives a visit
 * to another tab (#81). Tagged with its vault: a solve never follows a switch.
 */
export interface HeldSolve {
  vault: string;
  model: Model;
}

export function Practice({
  vault,
  held,
  onNote,
}: {
  vault: string;
  held: { current: HeldSolve | null };
  onNote: (m: string) => void;
}): React.JSX.Element {
  const [offer, setOffer] = useState<"loading" | "none" | { error: string } | null>("loading");
  const [model, setModel] = useState<Model | null>(null);
  // A view setting, remembered in the config (#81): the clock still counts.
  const [clockHidden, setClockHidden] = useState(false);
  useEffect(() => {
    void window.geode.configRead().then((r) => {
      if (r.ok && r.value?.hideClock === true) setClockHidden(true);
    });
  }, []);
  // The app's, not this screen's: a note read or a rating still in flight when
  // the tab changes lands here, and is waiting on return.
  const live = useMemo(
    () => ({
      get current(): Model | null {
        return held.current?.vault === vault ? held.current.model : null;
      },
    }),
    [held, vault],
  );

  const commit = useCallback(
    (next: Model) => {
      held.current = { vault, model: next };
      setModel(next);
    },
    [held, vault],
  );

  useEffect(() => {
    const kept = live.current;
    if (resumable(kept)) {
      setOffer(null);
      return commit(kept);
    }
    void window.geode.practiceNext().then((r) => {
      if (!r.ok) return setOffer({ error: r.message });
      if (r.value === null) return setOffer("none");
      setOffer(null);
      commit(start(r.value));
    });
  }, [commit, live]);

  const perform = useCallback(
    (effect: PracticeEffect | undefined) => {
      if (!effect) return;
      if (effect.kind === "clock") {
        setClockHidden((was) => {
          void window.geode.practiceHideClock(!was).then((r) => {
            if (!r.ok) onNote(`could not remember the clock setting: ${r.message}`);
          });
          return !was;
        });
        return;
      }
      const { review } = effect;
      if (effect.kind === "read-note") {
        void window.geode.noteRead(vault, review.filePath, review.id).then((r) => {
          if (!r.ok) onNote(`could not show the note: ${r.message}`);
          // Gone when the vault was switched meanwhile: the note is for a solve that is not held.
          const p = live.current;
          if (p) commit(noteArrived(p, r.ok ? r.value.text : null));
        });
        return;
      }
      if (effect.kind === "open") {
        void window.geode.noteOpen(review.filePath, null).then((r) => {
          if (!r.ok) onNote(r.message);
        });
        return;
      }
      const request = { skill: review.skill, kind: "solve" as const, exercise: review.exerciseId, repeat: review.repeat, ...(effect.took === null ? {} : { took: effect.took }), ...(effect.others ? { others: effect.others } : {}) };
      void window.geode.skillsReview(request, effect.rating).then((r) => {
        if (!r.ok) {
          onNote(r.message);
          const p = live.current;
          return p && commit(recorded(p, null, true));
        }
        if (r.value.applied === "log-only") onNote("saved — the database was busy and will catch up");
        const p = live.current;
        if (p) commit(recorded(p, r.value.next?.due ?? null));
      });
    },
    [commit, live, onNote, vault],
  );

  const handle = useCallback(
    (key: string) => {
      if (!live.current) return;
      const { next, effect } = press(live.current, key, new Date());
      commit(next);
      perform(effect);
    },
    [commit, live, perform],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Over the solution, a key the screen does not use is the page's: the
      // arrows, Space and Page Down scroll it.
      const kind = interpretPracticeKey(e.key).kind;
      if (live.current?.at === "solved" && (kind === "ignore" || kind === "toggle")) return;
      e.preventDefault();
      handle(e.key);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handle, live]);

  if (offer === "loading") return <p className="muted">loading…</p>;
  if (offer === "none") {
    return (
      <main className="practice done">
        <h2>Nothing to practise</h2>
        <p className="muted">No skill is due for a solve. Exercises are notes with a geode-skills property.</p>
      </main>
    );
  }
  if (offer !== null) return <p className="error">{offer.error}</p>;
  if (!model) return <p className="muted">loading…</p>;

  if (model.at === "left") {
    return (
      <main className="practice done">
        <h2>Left without rating</h2>
        <p className="muted">Nothing was recorded. The solve is still due.</p>
      </main>
    );
  }
  if (model.at === "done") {
    return (
      <main className="practice done">
        <h2>
          {model.review.title}
          <span className="muted"> — {SOLVE_RATING_KEYS[model.rating - 1]![1]}</span>
        </h2>
        {model.next && <p className="muted">{nextSolveText(model.review.skill, new Date(model.next))}</p>}
        <p className="muted">One solve per visit. The next one is offered when you come back.</p>
      </main>
    );
  }

  return model.at === "solving" ? (
    <Solving model={model} clockHidden={clockHidden} onKey={handle} />
  ) : (
    <Solved
      review={model.review}
      took={model.took}
      note={model.note}
      saving={model.at === "saving"}
      given={model.at === "solved" ? (model.given ?? []) : []}
      clockHidden={clockHidden}
      onKey={handle}
    />
  );
}

function Solving({
  model,
  clockHidden,
  onKey,
}: {
  model: Model & { at: "solving" };
  clockHidden: boolean;
  onKey: (k: string) => void;
}): React.JSX.Element {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const statement = useMemo(() => renderNote(model.review.statement, null).html, [model.review.statement]);

  return (
    <main className="practice">
      <header className="meta">
        <span>Practice · one solve</span>
        <span className="clock">
          {/* Hidden means the number, not the state: whether it is running
              is what a hidden clock still has to say. */}
          {!clockHidden && <span className="time">{clockText(elapsed(model, new Date()) * 1000)}</span>}
          {(clockHidden || clockState(model) !== "running") && (
            <span className="state muted">{clockStateText(clockState(model)!)}</span>
          )}
        </span>
      </header>
      <section className="card">
        <div className="front spot">
          <h3 className="spot-title">{model.review.title}</h3>
          {/* Sanitised in `renderNote`, like the viewer's note. */}
          <article className="note doc spot-statement" dangerouslySetInnerHTML={{ __html: statement }} />
          <p className="prompt">
            {clockState(model) === "not-started"
              ? "Read it, then start the clock when you start solving."
              : "Solve it wherever you solve things, then come back."}
          </p>
        </div>
      </section>
      <Legend stage="solving" clock={clockState(model)} onKey={onKey} />
    </main>
  );
}

function Solved({
  review,
  took,
  note,
  saving,
  given,
  clockHidden,
  onKey,
}: {
  review: SolveReview;
  took: number | null;
  note: string | null;
  saving: boolean;
  given: ReadonlyArray<{ skill: string; rating: 1 | 2 | 3 | 4 }>;
  clockHidden: boolean;
  onKey: (k: string) => void;
}): React.JSX.Element {
  const rendered = useMemo(() => (note === null ? null : renderNote(note, null).html), [note]);
  const related = relatedLines(review);

  return (
    <main className="practice">
      <header className="meta">
        <span>
          {review.skill}
          {ANSWER_ARROW}
          {review.title}
        </span>
        {!clockHidden && took !== null && <span className="clock">{clockText(took * 1000)}</span>}
      </header>
      <section className="viewer">
        {review.repeat && <p className="spot-repeat">{repeatText(review.skill)}</p>}
        {rendered === null ? (
          <p className="muted">reading the note…</p>
        ) : (
          <article className="note doc" tabIndex={-1} dangerouslySetInnerHTML={{ __html: rendered }} />
        )}
        {related.length > 0 && (
          <ul className="related">
            {related.map((line) => (
              <li key={line.label}>
                <span className="muted">{line.label}:</span> {line.titles.join(" · ")}
              </li>
            ))}
          </ul>
        )}
      </section>
      {/* Each skill rated in turn (ADR 0040): which one the keys rate next, and how the rest went. */}
      {rateSkillText(ratingOrder(review)[given.length] ?? "", given.length, ratingOrder(review).length) && (
        <p className="rate-which">
          {given.map((g) => `${g.skill}: ${SOLVE_RATING_KEYS[g.rating - 1]![1]} · `).join("")}
          {rateSkillText(ratingOrder(review)[given.length] ?? "", given.length, ratingOrder(review).length)}
        </p>
      )}
      <footer className="legend">
        <div className="ratings">
          {SOLVE_RATING_KEYS.map(([key, label]) => (
            <button key={key} className="rating" disabled={saving} onClick={() => onKey(key)}>
              <kbd>{key}</kbd> {label}
            </button>
          ))}
        </div>
        <div className="actions">
          {practiceKeysAt("solved").map((k) => (
            <button key={k.key} className="action" disabled={saving} onClick={() => onKey(k.key)}>
              <kbd>{k.shown}</kbd> {k.label}
            </button>
          ))}
        </div>
      </footer>
    </main>
  );
}

function Legend({
  stage,
  clock = null,
  onKey,
}: {
  stage: "solving" | "solved";
  clock?: "not-started" | "running" | "paused" | null;
  onKey: (k: string) => void;
}): React.JSX.Element {
  return (
    <footer className="legend">
      <div className="actions">
        {practiceKeysAt(stage).map((k) => (
          <button key={k.key} className="action" onClick={() => onKey(k.key)}>
            {/* Space's button says what it will do: start, pause or resume. */}
            <kbd>{k.shown}</kbd> {k.key === " " && clock ? startPauseLabel(clock) : k.label}
          </button>
        ))}
      </div>
    </footer>
  );
}
