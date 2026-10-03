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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ANSWER_ARROW,
  clockText,
  interpretPracticeKey,
  nextSolveText,
  practiceKeysAt,
  relatedLines,
  repeatText,
  SOLVE_RATING_KEYS,
} from "../../host/present.js";
import type { SolveReview } from "../../core/index.js";
import { elapsed, noteArrived, press, recorded, start } from "./model/practice.js";
import type { Practice as Model, PracticeEffect } from "./model/practice.js";
import { renderNote } from "./note.js";

export function Practice({ vault, onNote }: { vault: string; onNote: (m: string) => void }): React.JSX.Element {
  const [offer, setOffer] = useState<"loading" | "none" | { error: string } | null>("loading");
  const [model, setModel] = useState<Model | null>(null);
  const live = useRef<Model | null>(null);

  const commit = useCallback((next: Model) => {
    live.current = next;
    setModel(next);
  }, []);

  useEffect(() => {
    void window.geode.practiceNext().then((r) => {
      if (!r.ok) return setOffer({ error: r.message });
      if (r.value === null) return setOffer("none");
      setOffer(null);
      commit(start(r.value, new Date()));
    });
  }, [commit]);

  const perform = useCallback(
    (effect: PracticeEffect | undefined) => {
      if (!effect) return;
      const { review } = effect;
      if (effect.kind === "read-note") {
        void window.geode.noteRead(vault, review.filePath, review.id).then((r) => {
          if (!r.ok) onNote(`could not show the note: ${r.message}`);
          commit(noteArrived(live.current!, r.ok ? r.value.text : null));
        });
        return;
      }
      if (effect.kind === "open") {
        void window.geode.noteOpen(review.filePath, null).then((r) => {
          if (!r.ok) onNote(r.message);
        });
        return;
      }
      const request = { skill: review.skill, kind: "solve" as const, exercise: review.filePath, repeat: review.repeat, took: effect.took };
      void window.geode.skillsReview(request, effect.rating).then((r) => {
        if (!r.ok) {
          onNote(r.message);
          return commit(recorded(live.current!, null, true));
        }
        if (r.value.applied === "log-only") onNote("saved — the database was busy and will catch up");
        commit(recorded(live.current!, r.value.next?.due ?? null));
      });
    },
    [commit, onNote, vault],
  );

  const handle = useCallback(
    (key: string) => {
      if (!live.current) return;
      const { next, effect } = press(live.current, key, new Date());
      commit(next);
      perform(effect);
    },
    [commit, perform],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Over the solution, a key the screen does not use is the page's: the
      // arrows, Space and Page Down scroll it.
      const kind = interpretPracticeKey(e.key).kind;
      if (live.current?.at === "solved" && (kind === "ignore" || kind === "done")) return;
      e.preventDefault();
      handle(e.key);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handle]);

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
    <Solving model={model} onKey={handle} />
  ) : (
    <Solved review={model.review} took={model.took} note={model.note} saving={model.at === "saving"} onKey={handle} />
  );
}

function Solving({ model, onKey }: { model: Model & { at: "solving" }; onKey: (k: string) => void }): React.JSX.Element {
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
        <span className="clock">{clockText(elapsed(model, new Date()) * 1000)}</span>
      </header>
      <section className="card">
        <div className="front spot">
          <h3 className="spot-title">{model.review.title}</h3>
          {/* Sanitised in `renderNote`, like the viewer's note. */}
          <article className="note doc spot-statement" dangerouslySetInnerHTML={{ __html: statement }} />
          <p className="prompt">Solve it wherever you solve things, then come back.</p>
        </div>
      </section>
      <Legend stage="solving" onKey={onKey} />
    </main>
  );
}

function Solved({
  review,
  took,
  note,
  saving,
  onKey,
}: {
  review: SolveReview;
  took: number;
  note: string | null;
  saving: boolean;
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
        <span className="clock">{clockText(took * 1000)}</span>
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
      <footer className="legend">
        {SOLVE_RATING_KEYS.map(([key, label]) => (
          <button key={key} className="rating" disabled={saving} onClick={() => onKey(key)}>
            <kbd>{key}</kbd> {label}
          </button>
        ))}
        <span className="spacer" />
        {practiceKeysAt("solved").map((k) => (
          <button key={k.key} className="action" disabled={saving} onClick={() => onKey(k.key)}>
            <kbd>{k.shown}</kbd> {k.label}
          </button>
        ))}
      </footer>
    </main>
  );
}

function Legend({ stage, onKey }: { stage: "solving" | "solved"; onKey: (k: string) => void }): React.JSX.Element {
  return (
    <footer className="legend">
      <span className="spacer" />
      {practiceKeysAt(stage).map((k) => (
        <button key={k.key} className="action" onClick={() => onKey(k.key)}>
          <kbd>{k.shown}</kbd> {k.label}
        </button>
      ))}
    </footer>
  );
}
