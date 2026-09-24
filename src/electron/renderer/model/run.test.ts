import { describe, expect, it } from "vitest";
import { fromStatus, idle, isRunning, onFinished, onProgress, percent } from "./run.js";
import type { RunFinished, RunProgress, SyncSummary } from "../../ipc.js";

const summary = (over: Partial<SyncSummary> = {}): SyncSummary => ({
  filesEnumerated: 5,
  filesUnchanged: 4,
  filesRead: 1,
  filesDeferred: 0,
  filesStamped: 0,
  cardsFound: 3,
  cardsNew: 1,
  cardsUpdated: 0,
  cardsPruned: 0,
  reconciled: false,
  duplicatesReminted: 0,
  symlinkedDirsSkipped: 0,
  logShardsSkipped: 0,
  logBytesRead: 0,
  reviewsIngested: 0,
  filesSkippedOnError: 0,
  logLinesSkipped: 0,
  elapsedMs: 7,
  ...over,
});

const progress = (over: Partial<RunProgress> = {}): RunProgress => ({
  runId: "run-1",
  kind: "sync",
  phase: "scan",
  done: 1,
  total: 10,
  dryRun: false,
  ...over,
});

const finished = (over: Partial<RunFinished> = {}): RunFinished => ({
  runId: "run-1",
  kind: "sync",
  dryRun: false,
  result: { ok: true, value: summary() },
  ...over,
});

describe("how far along a run is", () => {
  it("is zero before the total is known, rather than NaN", () => {
    // Every run starts at total 0. A bar driven by NaN renders at zero width
    // forever while the run actually progresses.
    expect(percent(0, 0)).toBe(0);
    expect(Number.isNaN(percent(3, 0))).toBe(false);
  });

  it("clamps, because done can legitimately exceed total", () => {
    // The final emit forces done = total, and a file added mid-scan moves the
    // target underneath a run already counting.
    expect(percent(11, 10)).toBe(100);
    expect(percent(-1, 10)).toBe(0);
  });

  it("rounds to whole percent", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(5, 10)).toBe(50);
  });
});

describe("adopting a run the window did not start", () => {
  it("adopts a run already in flight when a window mounts late", () => {
    const v = fromStatus({ state: "running", progress: progress({ done: 4 }) });
    expect(v).toMatchObject({ at: "running", done: 4, total: 10 });
  });

  it("adopts a result the window was never subscribed for", () => {
    // The whole reason run/status carries `last`: a five-file sync finishes
    // before a component that started it has subscribed.
    const v = fromStatus({ state: "idle", last: finished() });
    expect(v.at).toBe("done");
  });

  it("tells never-run apart from finished", () => {
    expect(fromStatus({ state: "never" })).toEqual({ at: "idle" });
  });

  it("carries a failure across as a failure, not an empty summary", () => {
    const v = fromStatus({
      state: "idle",
      last: finished({ result: { ok: false, kind: "config", message: "notesPath is gone" } }),
    });
    expect(v).toMatchObject({ at: "failed", kindOfError: "config", message: "notesPath is gone" });
  });
});

describe("naming the phase a run is in", () => {
  it("names the phase rather than showing the enum", () => {
    // Without the phase the bar sits pinned at the end of the file loop for
    // the whole of prune and ingest, which on a first ingest is the longest
    // part of the run.
    expect(fromStatus({ state: "running", progress: progress({ phase: "ingest" }) })).toMatchObject({
      phase: "reading review history",
    });
  });
});

describe("events out of order", () => {
  it("does not put a finished run back on the bar", () => {
    // The throttle means a final progress emit and the finish event race.
    const done = onFinished(idle(), finished());
    expect(onProgress(done, progress({ done: 9 }))).toBe(done);
  });

  it("ignores a straggler from the previous run", () => {
    const current = onProgress(idle(), progress({ runId: "run-2", done: 1 }));
    const stale = onProgress(current, progress({ runId: "run-1", done: 99 }));
    expect(stale).toBe(current);
  });

  it("lets a newer run supersede an older one", () => {
    const old = onFinished(idle(), finished({ runId: "run-1" }));
    const next = onProgress(old, progress({ runId: "run-2" }));
    expect(next).toMatchObject({ at: "running", runId: "run-2" });
  });

  it("orders run ids numerically, not lexically", () => {
    // `run-10` sorts before `run-9` as a string — an off-by-one that would
    // only show up on the tenth run of a session.
    const nine = onProgress(idle(), progress({ runId: "run-9" }));
    const ten = onProgress(nine, progress({ runId: "run-10", done: 5 }));
    expect(ten).toMatchObject({ runId: "run-10" });
    expect(onProgress(ten, progress({ runId: "run-9", done: 1 }))).toBe(ten);
  });

  it("ignores a finish for a run that is not the current one", () => {
    const current = onProgress(idle(), progress({ runId: "run-3" }));
    expect(onFinished(current, finished({ runId: "run-2" }))).toBe(current);
  });
});

describe("dryRun travels with the run", () => {
  it("so a window that joined one does not claim notes were written", () => {
    const v = fromStatus({ state: "idle", last: finished({ dryRun: true }) });
    expect(v).toMatchObject({ at: "done", dryRun: true });
  });

  it("and is visible while it is still running", () => {
    expect(onProgress(idle(), progress({ dryRun: true }))).toMatchObject({ dryRun: true });
  });
});

describe("whether anything is running", () => {
  it("is true only in flight, because rebuild is refused while anything runs", () => {
    expect(isRunning(idle())).toBe(false);
    expect(isRunning(onProgress(idle(), progress()))).toBe(true);
    expect(isRunning(onFinished(idle(), finished()))).toBe(false);
  });
});
