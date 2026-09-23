/**
 * Milestone 1. This ships nothing and produces one number: the worst stall the
 * MAIN process suffers under each candidate architecture.
 *
 * The plan chose a utility process on the argument that a blocking `rebuild`
 * freezes the window, the menu, and every other IPC channel. That argument is
 * probably right and has never been measured — and this repo has now been
 * wrong twice about a performance number it had not taken (the enumerate
 * ratios, the cold-cache guess). So: measure, then decide.
 *
 * No BrowserWindow. The question is about the main process's event loop, and a
 * window would only add a second variable and a popup.
 *
 *   node dist/measure/vault.js /tmp/vault        # build the collection first
 *   npm --prefix desktop run measure -- /tmp/vault/config.json
 */

import { app, powerSaveBlocker, utilityProcess } from "electron";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { openCore, readAppConfig } from "../host/open.js";
import type { WorkerCommand, WorkerReply } from "../electron/protocol.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Generous, but finite. A hang must never look like slow work. */
const SYNC_TIMEOUT_MS = 5 * 60_000;

/** Enough reviews that the rebuild after them has a real log to replay. */
const REVIEW_BURST = 4000;

/**
 * Samples how late a 20 ms interval actually fires. Anything above the
 * interval is time the event loop was blocked and could not have answered a
 * click, a menu, or an IPC message.
 */
class Liveness {
  private timer: NodeJS.Timeout | null = null;
  private last = 0;
  private readonly gaps: number[] = [];
  private static readonly EVERY_MS = 20;

  start(): void {
    this.last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      this.gaps.push(now - this.last - Liveness.EVERY_MS);
      this.last = now;
    }, Liveness.EVERY_MS);
  }

  stop(): { worst: number; overFrame: number; samples: number } {
    if (this.timer) clearInterval(this.timer);
    const over = this.gaps.filter((g) => g > 16);
    return {
      worst: Math.max(0, ...this.gaps),
      overFrame: over.length,
      samples: this.gaps.length,
    };
  }
}

type Op = "sync" | "rebuild" | "reviews";

interface Result {
  worst: number;
  overFrame: number;
  /** Wall clock for the operation, without which a stall figure cannot be read. */
  elapsed: number;
}

/**
 * Core in the main process — the simple design the plan rejected on argument.
 *
 * Measured per operation, because they are not alike. `sync` is short
 * synchronous chunks separated by real awaits, so the loop breathes between
 * files. `rebuild` is `dropAll()` plus a replay of every review — one unbroken
 * block. A burst of ratings is an `fsync` each. Measuring only `sync` would
 * have answered the easy question and missed the one that decides this.
 */
async function inMain(configFile: string, op: Op): Promise<Result> {
  const config = await readAppConfig(configFile);
  if (!config) throw new Error(`no config at ${configFile}`);
  const { core, store } = openCore(config);

  /**
   * Start from a database that owes nothing.
   *
   * Each operation is measured after the previous one has already run — and the
   * one before this is the same operation in the worker, which writes 4,000
   * ratings and is then killed without closing. The write-ahead log it leaves
   * behind is folded in by whoever writes next, so without this the rating
   * figure is partly a charge for the *worker's* ratings, and a reader would
   * take it for a cost of rating. Nothing a real session does resembles that.
   */
  core.checkpoint();

  const probe = new Liveness();
  const began = performance.now();
  probe.start();
  try {
    if (op === "sync") {
      await withTimeout(core.sync(new Date(), { full: true }), SYNC_TIMEOUT_MS, "main sync");
    } else if (op === "rebuild") {
      await withTimeout(core.rebuild(new Date()), SYNC_TIMEOUT_MS, "main rebuild");
    } else {
      // Ratings are human-paced in real use, so the interesting number is the
      // worst single stall, not the total.
      const due = core.getDueCards(new Date(), REVIEW_BURST);
      for (const card of due) await core.reviewCard(card.id, 3, new Date());
    }
  } finally {
    store.close();
  }
  return { ...probe.stop(), elapsed: performance.now() - began };
}

/**
 * Fail loudly rather than hang.
 *
 * The first version of this waited on `child.once("spawn")` with no error path
 * and no timeout. The worker could not load — ESM emitted under a package.json
 * saying commonjs — so "spawn" never fired and the run sat there for fifteen
 * minutes looking like slow work. A measurement harness that cannot distinguish
 * "slow" from "dead" is worse than no harness.
 */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} did not finish within ${ms}ms`)), ms).unref(),
    ),
  ]);
}

/** Core in a utility process — two hops, main never touches SQLite. */
async function inWorker(configFile: string, op: Op): Promise<Result> {
  const child = utilityProcess.fork(path.join(HERE, "..", "electron", "worker", "main.js"), [], {
    stdio: "pipe",
  });
  child.stdout?.on("data", (b: Buffer) => process.stderr.write(`[worker] ${b.toString()}`));
  child.stderr?.on("data", (b: Buffer) => process.stderr.write(`[worker] ${b.toString()}`));

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      // A worker that dies on load exits without ever spawning.
      child.once("exit", (code: number) =>
        reject(new Error(`worker exited with ${code} before it started`)),
      );
    }),
    10_000,
    "worker spawn",
  );

  const probe = new Liveness();
  const began = performance.now();
  probe.start();
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        child.on("message", (reply: WorkerReply) => {
          if (reply.t === "error") reject(new Error(reply.message));
          else resolve();
        });
        child.once("exit", (code: number) =>
          reject(new Error(`worker exited with ${code} mid-sync`)),
        );
        child.postMessage({ t: op, id: 1, configFile, full: true } satisfies WorkerCommand);
      }),
      SYNC_TIMEOUT_MS,
      "worker sync",
    );
  } finally {
    const stats = probe.stop();
    child.kill();
    return { worst: stats.worst, overFrame: stats.overFrame, elapsed: performance.now() - began };
  }
}

/**
 * The elapsed time belongs next to the stall, and leaving it out was the first
 * report's other flaw: "worst 142 ms" means one thing inside a five-second
 * rebuild and something else entirely inside a three-minute one, and a reader
 * cannot tell which from a stall figure alone.
 */
function row(label: string, r: Result): string {
  const verdict = r.worst > 100 ? "UNUSABLE" : r.worst > 16 ? "janky" : "smooth";
  return (
    `  ${label.padEnd(22)} worst ${r.worst.toFixed(1).padStart(9)} ms   ` +
    `${String(r.overFrame).padStart(4)} stalls >16ms   ` +
    `${(r.elapsed / 1000).toFixed(1).padStart(7)} s total   ${verdict}`
  );
}

void app.whenReady().then(async () => {
  const configFile = process.argv[process.argv.length - 1]!;
  /**
   * macOS naps an app that has no window and is doing nothing, and a napped
   * process's timers stop firing — so the probe recorded a single 161-SECOND
   * "stall" for every run where main was merely waiting on the worker. That is
   * not a stall, it is the measurement instrument going to sleep, and it made
   * the utilityProcess column of the first report unreadable.
   *
   * Held for the whole run rather than per operation: what is being prevented
   * is suspension of an idle process, which is exactly the state the worker
   * rows put main in.
   */
  const awake = powerSaveBlocker.start("prevent-app-suspension");
  try {
    let out =
      `\n  worst MAIN-process event-loop stall, by operation\n` +
      `  electron ${process.versions.electron}  node ${process.versions.node}\n\n`;

    // Order matters, and getting it wrong was the first result's flaw:
    // `rebuild` replays every review through the scheduler, so measuring it
    // before anything had been reviewed measured the cheap half of it.
    for (const op of ["sync", "reviews", "rebuild"] as const) {
      // Worker first, so a pathological main run is not what poisons the page
      // cache for the other.
      const worker = await inWorker(configFile, op);
      const main = await inMain(configFile, op);
      out +=
        `  ${op}\n` +
        `${row("    core in main", main)}\n` +
        `${row("    utilityProcess", worker)}\n\n`;
    }

    out += `  >16ms drops a frame. >100ms is a click that feels ignored.\n\n`;
    process.stdout.write(out);
    powerSaveBlocker.stop(awake);
    app.exit(0);
  } catch (err) {
    process.stderr.write(`measure failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    powerSaveBlocker.stop(awake);
    app.exit(1);
  }
});
