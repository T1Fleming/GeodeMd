/**
 * What a long run looks like on screen, as a pure function of what has been
 * heard about it.
 *
 * No React, no IPC — the same split as `session.ts`, and for the same reason:
 * the awkward parts here are not drawing, they are *reconciliation*. A run
 * finishes in milliseconds on a small collection and in minutes on a large
 * one, events can arrive before a component subscribes or after it stopped
 * caring, and a window can be reloaded halfway through. Those are decisions,
 * and decisions belong somewhere they can be tested without a running app.
 */

import { PHASE_LABEL } from "../../../host/present.js";
import type {
  ErrorKind,
  RunFinished,
  RunProgress,
  RunStatus,
  SyncSummary,
} from "../../ipc.js";

export type RunKind = "sync" | "rebuild";

export type RunView =
  /** Nothing has run in this process, or nothing since the last one was shown. */
  | { at: "idle" }
  | { at: "running"; runId: string; kind: RunKind; dryRun: boolean; done: number; total: number; phase: string }
  | { at: "done"; runId: string; kind: RunKind; dryRun: boolean; summary: SyncSummary }
  | { at: "failed"; runId: string; kind: RunKind; dryRun: boolean; kindOfError: ErrorKind; message: string };

export const idle = (): RunView => ({ at: "idle" });

/**
 * How full the bar is, 0–100.
 *
 * `total === 0` is not "nothing to do" — it is "the total is not known yet",
 * which is the state every run starts in. Dividing anyway gives NaN, and a bar
 * driven by NaN renders at zero width forever while the run makes progress.
 *
 * Clamped because `done` can exceed `total` legitimately: the final emit
 * forces `done = total`, and a file added mid-scan moves the target.
 */
export function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function view(p: RunProgress): RunView {
  return {
    at: "running",
    runId: p.runId,
    kind: p.kind,
    dryRun: p.dryRun,
    done: p.done,
    total: p.total,
    // Looked up rather than spelled out: `host` owns the words, so the CLI
    // cannot later describe the same phase differently.
    phase: PHASE_LABEL[p.phase],
  };
}

function settled(f: RunFinished): RunView {
  const common = { runId: f.runId, kind: f.kind, dryRun: f.dryRun };
  return f.result.ok
    ? { at: "done", ...common, summary: f.result.value }
    : { at: "failed", ...common, kindOfError: f.result.kind, message: f.result.message };
}

/**
 * Adopt whatever the main process says is true.
 *
 * Called on mount, not only on an event. A component that mounts and then
 * starts a run can miss its own completion, and a window reloaded mid-sync was
 * never subscribed at all — in both cases the event is simply gone, and only
 * asking recovers it.
 */
export function fromStatus(status: RunStatus): RunView {
  if (status.state === "running") return view(status.progress);
  if (status.state === "idle") return settled(status.last);
  return idle();
}

/**
 * A progress event.
 *
 * Ignored once a run has finished, and ignored for a different run. Both are
 * real: the throttle means a final progress emit and the finish event race,
 * and adopting a late one would put a completed run back on the bar.
 */
export function onProgress(current: RunView, p: RunProgress): RunView {
  if (current.at !== "idle" && current.runId !== p.runId) {
    // A newer run supersedes an older one; an older one never supersedes a
    // newer. Without the ordering check, a straggler from the previous run
    // would replace the one the user is watching.
    if (!isNewer(p.runId, current.runId)) return current;
  } else if (current.at === "done" || current.at === "failed") {
    return current;
  }
  return view(p);
}

/** A finish event. Always adopted for the run it names, never for an older one. */
export function onFinished(current: RunView, f: RunFinished): RunView {
  if (current.at !== "idle" && current.runId !== f.runId && !isNewer(f.runId, current.runId)) {
    return current;
  }
  return settled(f);
}

/**
 * Run ids are `run-<n>` from a counter in the main process, so they order.
 *
 * Compared numerically rather than as strings, because `run-10` sorts before
 * `run-9` lexically — an off-by-one that would only appear on the tenth run of
 * a session and look like a random glitch.
 */
function isNewer(a: string, b: string): boolean {
  const n = (s: string): number => Number(s.replace(/^run-/, "")) || 0;
  return n(a) > n(b);
}

/** Is something in flight? `rebuild` is refused while anything is. */
export function isRunning(v: RunView): boolean {
  return v.at === "running";
}
