/**
 * The sync screen: start a run, watch it, read what it did.
 *
 * Dumb in the same way `Review.tsx` is — every decision about what the run
 * *is* lives in `model/run.ts`, and which counts are worth showing lives in
 * `host/present.ts`. What is left here is layout.
 */

import { useCallback, useEffect, useState } from "react";
import { deferralReason, exerciseReason, RUN_LABEL, summaryFields, unnestedReason } from "../../host/present.js";
import type { SummaryField } from "../../host/present.js";
import type { RunKind, SyncSummary } from "../ipc.js";
import { fromStatus, idle, isRunning, onFinished, onProgress, percent } from "./model/run.js";
import type { RunView } from "./model/run.js";

export function Sync(): React.JSX.Element {
  const [run, setRun] = useState<RunView>(idle);
  const [full, setFull] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmingFresh, setConfirmingFresh] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    // Reconcile on mount, THEN subscribe. A run started by another window, or
    // one still going after this window reloaded, is invisible to events that
    // have already fired — asking is the only way to find it.
    void window.geode.runStatus().then((r) => {
      if (r.ok) setRun(fromStatus(r.value));
    });
    const offProgress = window.geode.onRunProgress((p) => setRun((v) => onProgress(v, p)));
    const offFinished = window.geode.onRunFinished((f) => setRun((v) => onFinished(v, f)));
    return () => {
      offProgress();
      offFinished();
    };
  }, []);

  const start = useCallback(
    async (kind: RunKind, dryRun: boolean) => {
      setRefused(null);
      setConfirming(false);
      setConfirmingFresh(false);
      const r = await window.geode.runStart(kind, { full, dryRun });
      // A refusal is not an error worth a dialog: it means something else is
      // already running, which the screen is about to show anyway.
      if (!r.ok) setRefused(r.message);
    },
    [full],
  );

  const running = isRunning(run);

  return (
    <main className="screen">
      <h2>Sync</h2>
      <p className="muted lead">
        Reads your notes, writes an id into any card that has none, and picks up reviews
        recorded on other machines.
      </p>

      <div className="controls">
        <button className="primary" disabled={running} onClick={() => void start("sync", false)}>
          Sync
        </button>
        {/* Preview, not Sync --dry-run: the first sync of an existing
            collection writes an id comment into every note that holds a card,
            and `filesStamped` in the result is how many. */}
        <button disabled={running} onClick={() => void start("sync", true)}>
          Preview
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={full}
            disabled={running}
            onChange={(e) => setFull(e.target.checked)}
          />
          re-read every file
        </label>
      </div>

      {refused && <p className="refused">{refused}</p>}

      {run.at === "running" && <Progress view={run} />}
      {run.at === "done" && <Summary summary={run.summary} dryRun={run.dryRun} kind={run.kind} />}
      {run.at === "failed" && (
        <p className="error inline">
          {RUN_LABEL[run.kind]} failed — {run.message}
        </p>
      )}

      <Rebuild
        running={running}
        confirming={confirming}
        onAsk={() => setConfirming(true)}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void start("rebuild", false)}
      />

      <StartFresh
        running={running}
        confirming={confirmingFresh}
        onAsk={() => setConfirmingFresh(true)}
        onCancel={() => setConfirmingFresh(false)}
        onConfirm={() => void start("fresh", false)}
      />
    </main>
  );
}

/**
 * The bar, and the phase in words.
 *
 * The phase is not decoration. Without it the bar sits pinned at the end of
 * the file loop through `prune` and through `ingestLogs`, which on a first
 * ingest of a large log is the longest part of the run — and a bar that stops
 * moving reads as a hang.
 *
 * There is no cancel button, deliberately. `Core` takes no `AbortSignal`, and
 * killing a rebuild halfway leaves an emptied database with nothing to say so.
 * A button that cannot do what it says is worse than its absence.
 */
function Progress({ view }: { view: Extract<RunView, { at: "running" }> }): React.JSX.Element {
  const pct = percent(view.done, view.total);
  return (
    <section className="progress">
      <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="muted">
        {view.dryRun ? "previewing — " : ""}
        {view.phase}
        {view.total > 0 && ` — ${view.done} of ${view.total}`}
      </p>
    </section>
  );
}

function Summary({
  summary,
  dryRun,
  kind,
}: {
  summary: SyncSummary;
  dryRun: boolean;
  kind: RunKind;
}): React.JSX.Element {
  const fields = summaryFields(summary);
  const deferred = deferralReason(summary);
  const unnested = unnestedReason(summary);
  const exercises = exerciseReason(summary);

  return (
    <section className="summary">
      {dryRun && <p className="dry">Preview only — nothing was written.</p>}
      <dl className="fields">
        {fields.map((f) => (
          <Field key={f.key} field={f} />
        ))}
      </dl>
      <p className="muted small">
        {RUN_LABEL[kind]} finished in {summary.elapsedMs}ms
      </p>
      {/* Shown, not invented. Without it the counts read "3 cards found, 0
          new", which in a window — with no scrollback to reason from — looks
          like a bug rather than a deliberate pause. */}
      {deferred && (
        <p className="deferred">
          {deferred} Sync again to pick them up.
        </p>
      )}
      {unnested && <p className="deferred">{unnested}</p>}
      {exercises && <p className="deferred">{exercises}</p>}
    </section>
  );
}

function Field({ field }: { field: SummaryField }): React.JSX.Element {
  return (
    <div className={field.detail ? "field detail" : "field"}>
      <dt>{field.value}</dt>
      <dd>{field.label}</dd>
    </div>
  );
}

/**
 * Rebuild, behind two clicks and a sentence.
 *
 * Friction on purpose: it drops every row and derives the database again from
 * the notes and the logs, which is minutes on a large collection and is
 * refused outright while anything else is running. It is also the one button
 * here that is safe in a way worth saying out loud — nothing durable lives in
 * the database, so this cannot lose a review.
 */
function Rebuild({
  running,
  confirming,
  onAsk,
  onCancel,
  onConfirm,
}: {
  running: boolean;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  return (
    <section className="rebuild">
      {!confirming ? (
        <button className="quiet" disabled={running} onClick={onAsk}>
          Rebuild the database…
        </button>
      ) : (
        <div className="confirm">
          <p>
            Rebuild discards the database and derives it again from your notes and review
            logs. Nothing durable is lost — that is where your history actually lives — but
            on a large collection it takes minutes, and it cannot be stopped once started.
          </p>
          <div className="controls">
            <button className="primary" onClick={onConfirm}>
              Rebuild
            </button>
            <button onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Start fresh, behind two clicks and a sentence, like Rebuild.
 *
 * Unlike Rebuild it changes what the vault remembers: every card is new again.
 * Nothing is deleted — the review log moves to `.sr/archive/` and moving it
 * back undoes this — and no note is edited (ADR 0034). The sentence says all
 * three, and that every device sharing the folder follows, because that is
 * the part nobody would guess.
 */
function StartFresh({
  running,
  confirming,
  onAsk,
  onCancel,
  onConfirm,
}: {
  running: boolean;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  return (
    <section className="rebuild fresh">
      {!confirming ? (
        <button className="quiet" disabled={running} onClick={onAsk}>
          Start this vault fresh…
        </button>
      ) : (
        <div className="confirm">
          <p>
            Every card becomes new again, as if you had never reviewed it. Your review
            history is not deleted: it moves to <code>.sr/archive/</code> in your notes
            folder. Card ids and annotations stay, and no note is edited.
            Every device that shares this folder starts fresh too, on its next sync.
          </p>
          <div className="controls">
            <button className="primary" onClick={onConfirm}>
              Start fresh
            </button>
            <button onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
