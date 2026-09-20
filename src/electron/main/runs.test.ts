/**
 * The runner is deliberately free of Electron imports, so it tests under plain
 * vitest against a real temp vault and a real Store — no Electron, no mocks,
 * the same posture as every other test in this repo.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Core } from "../../core/index.js";
import { Store } from "../../store/index.js";
import type { Result, RunFinished, RunProgress, SyncSummary } from "../ipc.js";
import { Runner } from "./runs.js";

let notes: string;
let store: Store;
let core: Core;
let n = 0;

const T0 = new Date("2026-09-02T12:00:00.000Z");
const MTIME = new Date("2026-09-01T00:00:00.000Z");

beforeEach(async () => {
  notes = await fs.mkdtemp(path.join(os.tmpdir(), "geode-runs-"));
  store = new Store(":memory:");
  n = 0;
  core = new Core(
    {
      notesPath: notes,
      device: "test-0001",
      dbPath: ":memory:",
      newId: () => `sr-${String(++n).padStart(12, "0")}`,
    },
    store,
  );
});
afterEach(async () => {
  store.close();
  await fs.rm(notes, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(notes, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  await fs.utimes(abs, MTIME, MTIME);
}

/** A runner whose throttle fires on demand, so nothing waits in real time. */
function makeRunner(): {
  runner: Runner;
  progress: RunProgress[];
  finished: RunFinished[];
  tick: () => void;
  done: () => Promise<void>;
} {
  const progress: RunProgress[] = [];
  const finished: RunFinished[] = [];
  let scheduled: (() => void) | null = null;
  let resolveDone: (() => void) | null = null;

  const runner = new Runner({
    core,
    emit: (p) => progress.push(p),
    finish: (f) => {
      finished.push(f);
      resolveDone?.();
    },
    now: () => T0,
    schedule: (fn) => {
      scheduled = fn;
      return { cancel: () => (scheduled = null) };
    },
  });

  return {
    runner,
    progress,
    finished,
    tick: () => scheduled?.(),
    done: () =>
      new Promise<void>((resolve) => {
        if (finished.length) return resolve();
        resolveDone = resolve;
      }),
  };
}

describe("single-flight", () => {
  it("a second sync JOINS the first rather than failing", async () => {
    // Two windows asking to sync meant one sync. An error there answers a
    // question nobody asked.
    await write("a.md", "Q :: A\n");
    const h = makeRunner();

    const first = h.runner.start("sync", { full: false, dryRun: false });
    const second = h.runner.start("sync", { full: false, dryRun: false });

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.joined).toBe(true);
      expect(second.value.runId).toBe(first.value.runId);
    }
    await h.done();
  });

  it("a rebuild cannot join a sync", async () => {
    // dropAll is destructive, so a joiner would get a summary for a database
    // it did not expect.
    await write("a.md", "Q :: A\n");
    const h = makeRunner();

    h.runner.start("sync", { full: false, dryRun: false });
    const rebuild = h.runner.start("rebuild", { full: false, dryRun: false });

    expect(rebuild.ok).toBe(false);
    if (!rebuild.ok) expect(rebuild.message).toContain("already running");
    await h.done();
  });

  it("frees the slot when the run ends", async () => {
    await write("a.md", "Q :: A\n");
    const h = makeRunner();
    h.runner.start("sync", { full: false, dryRun: false });
    await h.done();

    expect(h.runner.status().state).toBe("idle");
    const again = h.runner.start("sync", { full: false, dryRun: false });
    expect(again.ok && again.value.joined).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe("progress", () => {
  it("emits on the timer, not on every callback", async () => {
    // onProgress fires once per enumerated file including cache hits — a
    // million calls at the top of the scale range. One send per call would
    // flood the renderer, so the hot path only records.
    for (let i = 0; i < 40; i++) await write(`n${i}.md`, "Q :: A\n");
    const h = makeRunner();

    h.runner.start("sync", { full: false, dryRun: false });
    await h.done();

    // No ticks were fired, so the only emit is the final one.
    expect(h.progress.length).toBe(1);
  });

  it("always ends at 100%, even if the throttle dropped the last update", async () => {
    // A bar that stops at 999,847 of a million looks broken rather than done.
    for (let i = 0; i < 10; i++) await write(`n${i}.md`, "Q :: A\n");
    const h = makeRunner();

    h.runner.start("sync", { full: false, dryRun: false });
    await h.done();

    const last = h.progress.at(-1)!;
    expect(last.done).toBe(last.total);
    expect(last.total).toBe(10);
  });

  it("carries the run id and kind on every emit", async () => {
    // Phase ORDERING is core's contract and is tested there. What the runner
    // owes is that an emit can be attributed: a stale run must not be able to
    // paint over a current one.
    await write("a.md", "Q :: A\n");
    const h = makeRunner();

    const started = h.runner.start("sync", { full: false, dryRun: false });
    await h.done();

    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(h.progress.length).toBeGreaterThan(0);
    for (const p of h.progress) {
      expect(p.runId).toBe(started.value.runId);
      expect(p.kind).toBe("sync");
    }
  });
});

describe("results", () => {
  it("returns a summary rather than throwing", async () => {
    await write("a.md", "Q :: A\n");
    const h = makeRunner();
    h.runner.start("sync", { full: false, dryRun: false });
    await h.done();

    const f = h.finished[0]!;
    expect(f.result.ok).toBe(true);
    if (f.result.ok) expect(f.result.value.cardsNew).toBe(1);
  });

  it("tags a missing notes directory as config, not internal", async () => {
    // The error crosses as a tag because its prototype would not survive.
    await fs.rm(notes, { recursive: true, force: true });
    const h = makeRunner();
    h.runner.start("sync", { full: false, dryRun: false });
    await h.done();

    const f = h.finished[0]!;
    expect(f.result.ok).toBe(false);
    if (!f.result.ok) expect(f.result.kind).toBe("config");
  });
});

describe("the wire types survive structuredClone", () => {
  it("clones every payload a real run produces", async () => {
    // structuredClone THROWS on a function, so this catches a callback
    // sneaking into a payload — which no type survives one `as any`.
    await write("a.md", "Q :: A\n");
    const h = makeRunner();
    h.runner.start("sync", { full: false, dryRun: false });
    await h.done();

    for (const p of h.progress) expect(structuredClone(p)).toEqual(p);
    for (const f of h.finished) expect(structuredClone(f)).toEqual(f);
    expect(structuredClone(core.getDueCards(T0, 5))).toEqual(core.getDueCards(T0, 5));
    expect(structuredClone(core.stats(T0))).toEqual(core.stats(T0));
  });

  it("and core's own Config does NOT — which is why the wire type differs", async () => {
    // Executable documentation for why AppConfig exists as a separate name.
    // Config.newId is a function and the type looks like plain data.
    const config = { notesPath: notes, device: "d", dbPath: ":memory:", newId: () => "x" };
    expect(() => structuredClone(config)).toThrow();
  });
});

describe("status survives a missed event", () => {
  it("distinguishes never-run from finished", async () => {
    // Two different things to a UI deciding what to render, and a nullable
    // progress object cannot tell them apart.
    await write("a.md", "Q :: A\n");
    const h = makeRunner();
    expect(h.runner.status()).toEqual({ state: "never" });

    h.runner.start("sync", { full: false, dryRun: false });
    await h.done();
    expect(h.runner.status().state).toBe("idle");
  });

  it("keeps the last result, so a late subscriber can still learn it", async () => {
    // The gap this closes: a five-file sync finishes in milliseconds, so a
    // component that mounts and then starts a run can miss its own completion.
    await write("a.md", "Q :: A\n");
    const h = makeRunner();
    const started = h.runner.start("sync", { full: false, dryRun: false });
    await h.done();

    const s = h.runner.status();
    expect(s.state).toBe("idle");
    if (s.state !== "idle") return;
    expect(started.ok && s.last.runId).toBe(started.ok && started.value.runId);
    expect(s.last.result.ok).toBe(true);
  });

  it("reports running while a run is in flight", async () => {
    await write("a.md", "Q :: A\n");
    const h = makeRunner();
    h.runner.start("sync", { full: false, dryRun: false });
    expect(h.runner.status().state).toBe("running");
    await h.done();
  });

  it("a new run supersedes the previous result rather than aging it out", async () => {
    // "The most recent run" is a fact about the process. An expiry would mean
    // a UI that renders differently depending on how long the user looked away.
    await write("a.md", "Q :: A\n");
    const h = makeRunner();
    h.runner.start("sync", { full: false, dryRun: false });
    await h.done();
    const first = h.runner.status();

    const second = h.runner.start("sync", { full: false, dryRun: false });
    expect(h.runner.status().state).toBe("running");
    await new Promise((r) => setTimeout(r, 60));

    const s = h.runner.status();
    if (s.state !== "idle" || first.state !== "idle") return;
    expect(s.last.runId).not.toBe(first.last.runId);
    expect(second.ok && s.last.runId).toBe(second.ok && second.value.runId);
  });

  it("status is structured-cloneable, like every other payload", async () => {
    await write("a.md", "Q :: A\n");
    const h = makeRunner();
    h.runner.start("sync", { full: false, dryRun: false });
    await h.done();
    const s = h.runner.status();
    expect(structuredClone(s)).toEqual(s);
  });
});
