/**
 * First run, and the repair case.
 *
 * Every decision is in `model/setup.ts` — especially the one that matters,
 * which is that the real sync is unreachable without a preview of what it
 * would do. This file is the walk through it.
 *
 * The same component serves a config whose `notesPath` no longer exists. That
 * is routine on a desktop (the folder moved, or a drive is unmounted) and is
 * *not* a first run, so it opens at the folder step and says so, rather than
 * greeting someone who has been using the app for a year.
 */

import { useCallback, useEffect, useState } from "react";
import type { AppConfig, ConfigProposal, FolderReport, SyncSummary } from "../ipc.js";
import {
  back,
  begin,
  blockers,
  canAdvance,
  canSync,
  next,
  picked,
  previewReport,
  previewed,
  proposed,
  setAcknowledged,
  setReplace,
} from "./model/setup.js";
import type { Setup as SetupState } from "./model/setup.js";

interface Props {
  /** The config being repaired, or null on a genuine first run. */
  repairing: AppConfig | null;
  onReady: () => void;
}

export function Setup({ repairing, onReady }: Props): React.JSX.Element {
  const [s, setS] = useState<SetupState>(() =>
    // A repair skips the welcome: the user knows what this is.
    repairing ? { ...begin(), step: "confirm" } : begin(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = useCallback(async () => {
    setError(null);
    const chosen = await window.geode.setupPick();
    if (!chosen.ok) return setError(chosen.message);
    // Null is a cancel, which is an ordinary answer — not an error, and not a
    // reason to move the user anywhere.
    if (chosen.value === null) return;
    const report = await window.geode.setupInspect(chosen.value);
    if (!report.ok) return setError(report.message);
    setS((prev) => picked(prev, report.value));
  }, []);

  // Fetch the proposal when the config step opens, so the screen can show what
  // would be written before anything is.
  useEffect(() => {
    if (s.step !== "config" || !s.folder || s.proposal) return;
    void window.geode.setupPropose(s.folder.path).then((r) => {
      if (r.ok) setS((prev) => proposed(prev, r.value));
      else setError(r.message);
    });
  }, [s.step, s.folder, s.proposal]);

  const preview = useCallback(async () => {
    if (!s.folder) return;
    setBusy(true);
    setError(null);
    try {
      // The config has to exist before a run can read it, so the write happens
      // here rather than at the end — safe, because writing a config touches
      // none of the user's notes. The sync is the irreversible step, and it is
      // still behind the button below.
      //
      // `replace: true` unconditionally, and deliberately. The refusal that
      // `init` makes without `--force` was already surfaced — as a choice, on
      // the settings step, BEFORE anything was written. Letting it fire again
      // here would only mean the second preview of the same run failing
      // because the first one succeeded.
      const written = await window.geode.setupWrite(s.folder.path, true);
      if (!written.ok) return setError(written.message);
      const summary = await runToCompletion(true);
      if (typeof summary === "string") return setError(summary);
      setS((prev) => previewed(prev, summary));
    } finally {
      setBusy(false);
    }
  }, [s.folder, s.replace]);

  const syncForReal = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const summary = await runToCompletion(false);
      if (typeof summary === "string") return setError(summary);
      onReady();
    } finally {
      setBusy(false);
    }
  }, [onReady]);

  /**
   * Keep the settings that are already there.
   *
   * A way out of this sequence rather than a step through it: the sequence
   * exists to point at the newly chosen folder, so continuing would write
   * exactly what the user just declined. Re-checked rather than trusted,
   * because the usual reason for being here at all is that the old path had
   * gone — and if it is still gone, saying so beats bouncing the user back to
   * this same screen.
   */
  const keepExisting = useCallback(async () => {
    const old = s.proposal?.replaces;
    if (!old) return;
    setError(null);
    const report = await window.geode.setupInspect(old.notesPath);
    if (!report.ok) return setError(report.message);
    if (!report.value.exists || !report.value.isDirectory) {
      return setError(
        `${old.notesPath} is still not there. Reconnect it, or choose the new folder.`,
      );
    }
    onReady();
  }, [s.proposal, onReady]);

  const stop = blockers(s);

  return (
    <main className="screen setup">
      {s.step === "welcome" && <Welcome onPick={() => void pick()} />}

      {s.step === "confirm" && (
        <ConfirmFolder
          report={s.folder}
          repairing={repairing}
          onPick={() => void pick()}
        />
      )}

      {s.step === "config" && (
        <PreviewConfig
          proposal={s.proposal}
          replace={s.replace}
          onReplace={(v) => setS((p) => setReplace(p, v))}
          onKeep={() => void keepExisting()}
        />
      )}

      {s.step === "vcs" && (
        <VersionControl
          isGitRepo={s.folder?.isGitRepo === true}
          acknowledged={s.acknowledged}
          onAcknowledge={(v) => setS((p) => setAcknowledged(p, v))}
        />
      )}

      {s.step === "preview" && (
        <PreviewSync
          state={s}
          busy={busy}
          onPreview={() => void preview()}
          onSync={() => void syncForReal()}
        />
      )}

      {error && <p className="error inline">{error}</p>}
      {stop.length > 0 && s.step !== "welcome" && <p className="blocker">{stop[0]}</p>}

      <div className="controls wizard">
        {s.step !== "welcome" && (
          <button disabled={busy} onClick={() => setS(back)}>
            Back
          </button>
        )}
        {s.step !== "preview" && (
          <button className="primary" disabled={!canAdvance(s) || busy} onClick={() => setS(next)}>
            Continue
          </button>
        )}
      </div>
    </main>
  );
}

/**
 * Start a run and wait for it to finish, as a string message on failure.
 *
 * Subscribes BEFORE starting, which is the opposite of the usual advice and
 * right here: there is no screen to reconcile on mount, so the event is the
 * only notification, and a first sync of a small collection finishes in
 * milliseconds.
 */
async function runToCompletion(dryRun: boolean): Promise<SyncSummary | string> {
  return new Promise((resolve) => {
    const off = window.geode.onRunFinished((f) => {
      off();
      resolve(f.result.ok ? f.result.value : f.result.message);
    });
    void window.geode.runStart("sync", { full: false, dryRun }).then((r) => {
      if (!r.ok) {
        off();
        resolve(r.message);
      }
    });
  });
}

function Welcome({ onPick }: { onPick: () => void }): React.JSX.Element {
  return (
    <>
      <h2>GeodeMD</h2>
      <p className="lead">
        Spaced repetition over your own Markdown notes. Cards are ordinary lines in your
        files — <code>question :: answer</code> — so everything stays readable, and yours,
        with or without this app.
      </p>
      <p className="lead muted">
        Point it at the folder your notes live in. Nothing is written until you have seen
        what would change.
      </p>
      <button className="primary" onClick={onPick}>
        Choose folder…
      </button>
    </>
  );
}

/**
 * What is actually in there.
 *
 * The count is the check writing a config cannot make, and the likeliest first-run
 * mistake is pointing at a Downloads folder or at the parent of the notes. It
 * is a **soft** warning: an empty folder is a fine place to start.
 */
function ConfirmFolder({
  report,
  repairing,
  onPick,
}: {
  report: FolderReport | null;
  repairing: AppConfig | null;
  onPick: () => void;
}): React.JSX.Element {
  return (
    <>
      <h2>{repairing ? "Where did your notes go?" : "Is this the right folder?"}</h2>
      {repairing && !report && (
        <p className="lead">
          Your notes were at <code>{repairing.notesPath}</code>, which is not there any
          more. If the folder moved — or lives on a drive that is not plugged in — point
          GeodeMD at it again. Nothing has been lost: your review history lives beside
          your notes.
        </p>
      )}
      {report && (
        <>
          <p className="path">{report.path}</p>
          <div className="tiles">
            <Tile value={report.markdownFiles} label="Markdown files" strong />
            <Tile value={report.isGitRepo ? "yes" : "no"} label="a git repository" />
          </div>
          {report.markdownFiles === 0 && (
            <p className="warn">
              No Markdown files in there. That is fine if you are starting fresh — but if
              you expected notes, this is probably the wrong folder.
            </p>
          )}
          {report.symlinkedDirs > 0 && (
            <p className="muted small">
              {report.symlinkedDirs} linked{" "}
              {report.symlinkedDirs === 1 ? "folder" : "folders"} will be skipped.
            </p>
          )}
        </>
      )}
      <button onClick={onPick}>Choose a different folder…</button>
    </>
  );
}

/**
 * What would be written, before it is.
 *
 * `preserved` is said out loud on purpose: `init` already keeps `device` and
 * `editor` across a replace — regenerating `device` would quietly start a
 * second log shard and scatter one machine's history across two names — but a
 * GUI that keeps a field without mentioning it looks like it ignored you.
 */
function PreviewConfig({
  proposal,
  replace,
  onReplace,
  onKeep,
}: {
  proposal: ConfigProposal | null;
  replace: boolean | null;
  onReplace: (v: boolean) => void;
  onKeep: () => void;
}): React.JSX.Element {
  if (!proposal) return <p className="muted">reading your settings…</p>;

  return (
    <>
      <h2>Settings</h2>
      <dl className="settings">
        <Row label="notes" value={proposal.notesPath} />
        <Row label="this device" value={proposal.device} />
        <Row label="database" value={proposal.dbPath} />
      </dl>
      <p className="muted small">
        The database is a cache and can be rebuilt at any time. What matters lives in your
        notes and in the review log beside them.
      </p>

      {proposal.replaces && (
        <div className="choice">
          <p>
            You already have settings pointing at <code>{proposal.replaces.notesPath}</code>.
          </p>
          <div className="controls">
            {/* Leaves the sequence rather than advancing through it — see
                `keepExisting`. Continuing would write the path just declined. */}
            <button
              className={replace === false ? "primary" : ""}
              onClick={() => {
                onReplace(false);
                onKeep();
              }}
            >
              Keep those
            </button>
            <button
              className={replace === true ? "primary" : ""}
              onClick={() => onReplace(true)}
            >
              Use the new folder
            </button>
          </div>
          <p className="muted small">
            Either way your device name{proposal.preserved.includes("editor") && " and editor setting"}{" "}
            {proposal.preserved.length > 1 ? "are" : "is"} kept — changing the device name
            would split this machine's review history across two files.
          </p>
        </div>
      )}
    </>
  );
}

/**
 * The one gate worth having.
 *
 * Not a block — an acknowledgement. The advice differs by whether the folder
 * is version-controlled, because "commit first" is useless to someone with no
 * repository and "make a backup" is noise to someone with one.
 */
function VersionControl({
  isGitRepo,
  acknowledged,
  onAcknowledge,
}: {
  isGitRepo: boolean;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
}): React.JSX.Element {
  return (
    <>
      <h2>Before anything is written</h2>
      <p className="lead">
        The first sync writes a short id comment into every line that is a card. That is
        how a card keeps its identity when you move it between files — but on a collection
        you already have, it touches a lot of notes at once.
      </p>
      <p className="lead">
        {isGitRepo ? (
          <>
            This folder is a git repository. <strong>Commit what you have first</strong>, so
            the change arrives as a diff you can read and undo.
          </>
        ) : (
          <>
            This folder is not under version control. <strong>Consider a copy</strong> before
            you continue — not because this is risky, but because being able to compare is
            worth a great deal the first time.
          </>
        )}
      </p>
      <label className="check big">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onAcknowledge(e.target.checked)}
        />
        I understand my notes will be edited
      </label>
    </>
  );
}

/**
 * The preview, and then the only button in the app that starts a real first
 * sync. It is unreachable without the preview above it — see `canSync`.
 */
function PreviewSync({
  state,
  busy,
  onPreview,
  onSync,
}: {
  state: SetupState;
  busy: boolean;
  onPreview: () => void;
  onSync: () => void;
}): React.JSX.Element {
  const report = state.preview ? previewReport(state.preview) : null;

  return (
    <>
      <h2>What would change</h2>
      {!report && (
        <p className="lead">
          A preview reads everything and writes nothing, so you can see the size of the
          change before making it.
        </p>
      )}

      <button className={report ? "" : "primary"} disabled={busy} onClick={onPreview}>
        {busy ? "Reading…" : report ? "Preview again" : "Preview"}
      </button>

      {report && (
        <>
          <p className="lead">
            {report.filesRead} {report.filesRead === 1 ? "file" : "files"} read,{" "}
            {report.cardsFound} {report.cardsFound === 1 ? "card" : "cards"} found, and{" "}
            {/* The number this screen exists for. Not cardsNew — one file can
                hold fifty cards, and the question being asked is how many of
                the user's notes get rewritten. */}
            <strong>
              {report.notesEdited} {report.notesEdited === 1 ? "note" : "notes"} would be
              edited
            </strong>
            .
          </p>
          {report.notesEdited === 0 && (
            <p className="muted">
              Nothing to stamp — either there are no cards yet, or they all have ids
              already.
            </p>
          )}
          <button className="primary" disabled={!canSync(state) || busy} onClick={onSync}>
            {busy ? "Syncing…" : "Sync for real"}
          </button>
        </>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Tile({
  value,
  label,
  strong = false,
}: {
  value: number | string;
  label: string;
  strong?: boolean;
}): React.JSX.Element {
  return (
    <div className={strong ? "tile strong" : "tile"}>
      <span className="value">{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}
