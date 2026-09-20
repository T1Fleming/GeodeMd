/**
 * Long runs: single-flight, and progress that does not flood.
 *
 * Deliberately free of Electron imports so it can be tested under plain vitest
 * against a real `Core` and a real temp vault — the same shape `core` itself
 * has, and the only reason any of this is testable in a repo with no mocks.
 */

import type { Core, SyncSummary } from "../../core/index.js";
import { classify } from "../../host/errors.js";
import type { Result, RunProgress, RunStarted, SyncRequest } from "../ipc.js";

/** How often progress is emitted, regardless of how often it is reported. */
export const EMIT_EVERY_MS = 100;

export interface RunnerDeps {
  core: Core;
  emit: (p: RunProgress) => void;
  finish: (runId: string, kind: "sync" | "rebuild", result: Result<SyncSummary>) => void;
  now?: () => Date;
  /** Injected so the throttle can be tested without waiting in real time. */
  schedule?: (fn: () => void, ms: number) => { cancel: () => void };
}

interface InFlight {
  runId: string;
  kind: "sync" | "rebuild";
  latest: RunProgress;
}

export class Runner {
  private inFlight: InFlight | null = null;
  private seq = 0;

  constructor(private readonly deps: RunnerDeps) {}

  status(): RunProgress | null {
    return this.inFlight?.latest ?? null;
  }

  /**
   * Start a run, or join one.
   *
   * A second `sync` request while a sync is running **joins** it and gets the
   * same runId — two windows asking to sync meant one sync, and an error there
   * would be answering a question nobody asked.
   *
   * A `rebuild` cannot join anything and nothing can join a rebuild: `dropAll`
   * is destructive, so a joiner would receive a summary for a database it did
   * not expect. It is refused while anything is in flight.
   *
   * This guards THIS process only. Another `geode sync` in a terminal at the
   * same time is fine and is designed for — WAL, the busy timeout, and the
   * re-stat before each write. Do not add a lock file.
   */
  start(kind: "sync" | "rebuild", req: SyncRequest): Result<RunStarted> {
    if (this.inFlight) {
      if (kind === "sync" && this.inFlight.kind === "sync") {
        return { ok: true, value: { runId: this.inFlight.runId, joined: true } };
      }
      return {
        ok: false,
        kind: "internal",
        message: `a ${this.inFlight.kind} is already running`,
      };
    }

    const runId = `run-${++this.seq}`;
    const latest: RunProgress = { runId, kind, phase: "scan", done: 0, total: 0 };
    this.inFlight = { runId, kind, latest };

    void this.run(runId, kind, req);
    return { ok: true, value: { runId, joined: false } };
  }

  private async run(runId: string, kind: "sync" | "rebuild", req: SyncRequest): Promise<void> {
    const now = this.deps.now ?? (() => new Date());
    const schedule = this.deps.schedule ?? defaultSchedule;

    let dirty = false;
    const timer = schedule(() => {
      if (!dirty || !this.inFlight) return;
      dirty = false;
      this.deps.emit({ ...this.inFlight.latest });
    }, EMIT_EVERY_MS);

    // The hot path. `onProgress` fires once per enumerated file including the
    // ones the mtime cache skips — a million calls at the top of the scale
    // range — so this does two field writes and nothing else. No clock, no
    // allocation, no send.
    const onProgress = (done: number, total: number, phase: RunProgress["phase"]): void => {
      const f = this.inFlight;
      if (!f) return;
      f.latest.done = done;
      f.latest.total = total;
      f.latest.phase = phase;
      dirty = true;
    };

    let result: Result<SyncSummary>;
    try {
      const summary =
        kind === "sync"
          ? await this.deps.core.sync(now(), { ...req, onProgress })
          : await this.deps.core.rebuild(now(), { ...req, onProgress });
      result = { ok: true, value: summary };
    } catch (err) {
      // Tagged here, while the error still has its prototype.
      result = {
        ok: false,
        kind: classify(err),
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      timer.cancel();
    }

    // One final emit at 100%, unconditionally: the throttle may have dropped
    // the last update, and a bar that stops at 999,847 of a million looks
    // broken rather than finished.
    const f = this.inFlight;
    if (f) this.deps.emit({ ...f.latest, done: f.latest.total, phase: "ingest" });

    this.inFlight = null;
    this.deps.finish(runId, kind, result);
  }
}

function defaultSchedule(fn: () => void, ms: number): { cancel: () => void } {
  const t = setInterval(fn, ms);
  return { cancel: () => clearInterval(t) };
}
