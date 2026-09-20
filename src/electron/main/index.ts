/**
 * The Electron main process. Owns the window, the `Store`, and the `Core`.
 *
 * `core` runs here rather than in a utility process — measured, not assumed;
 * see ADR 0017. The decision rests on `core`'s long operations being chunked,
 * so a change that introduces one long synchronous span invalidates it and the
 * bench in `measure.bench.ts` is how you find out.
 */

import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Core } from "../../core/index.js";
import type { Store } from "../../store/index.js";
import { classify, isBusy } from "../../host/errors.js";
import { openCore, readAppConfig } from "../../host/open.js";
import { CH } from "../ipc.js";
import type { AppConfig, Rated, Result, Stats, SyncRequest } from "../ipc.js";
import { Runner } from "./runs.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let core: Core | null = null;
let store: Store | null = null;
let runner: Runner | null = null;
let win: BrowserWindow | null = null;

/**
 * Lazily, on the first command that needs it — never at startup. On a first run
 * there is no config and therefore no dbPath, and opening a database at a path
 * nobody chose is how a stray db.sqlite appears in someone's home directory.
 */
async function ensureCore(): Promise<Core> {
  if (core) return core;
  const config = await readAppConfig();
  if (!config) throw new NoConfig();
  const opened = openCore(config);
  core = opened.core;
  store = opened.store;
  runner = new Runner({
    core: opened.core,
    emit: (p) => win?.webContents.send(CH.runProgress, p),
    finish: (runId, kind, result) => win?.webContents.send(CH.runFinished, { runId, kind, result }),
  });
  return core;
}

class NoConfig extends Error {}

/**
 * Every handler goes through here, so no handler can throw across the wire —
 * which would arrive on the far side as a bare Error with its prototype and
 * its `.code` stripped.
 */
async function guard<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    if (err instanceof NoConfig) {
      return { ok: false, kind: "no-config", message: "no config yet" };
    }
    return {
      ok: false,
      kind: classify(err),
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function register(): void {
  ipcMain.handle(CH.configRead, () =>
    guard<AppConfig | null>(async () => {
      const c = await readAppConfig();
      // Null rather than an error: a first run is an ordinary state, and code
      // that decides "show setup" by catching an exception eventually shows
      // setup after a disk error.
      return c ? { notesPath: c.notesPath, device: c.device, dbPath: c.dbPath } : null;
    }),
  );

  ipcMain.handle(CH.statsRead, () =>
    guard<Stats>(async () => {
      const c = await ensureCore();
      return c.stats(new Date());
    }),
  );

  ipcMain.handle(CH.cardsDue, (_e, limit: number) =>
    guard(async () => {
      const c = await ensureCore();
      return c.getDueCards(new Date(), limit);
    }),
  );

  ipcMain.handle(CH.cardsReview, (_e, cardId: string, rating: 1 | 2 | 3 | 4) =>
    guard<Rated>(async () => {
      const c = await ensureCore();
      try {
        await c.reviewCard(cardId, rating, new Date());
        return { applied: "db" };
      } catch (err) {
        // The rating is already fsynced to the log, so a busy database is not a
        // failure — the next ingest reconciles it. Reported as success with a
        // qualifier so the UI can say so quietly and move on.
        if (isBusy(err)) return { applied: "log-only" };
        throw err;
      }
    }),
  );

  ipcMain.handle(CH.runStart, async (_e, kind: "sync" | "rebuild", req: SyncRequest) => {
    const r = await guard(async () => {
      await ensureCore();
      return runner!.start(kind, req);
    });
    // `start` returns a Result of its own; unwrap rather than nest.
    return r.ok ? r.value : r;
  });

  ipcMain.handle(CH.runStatus, () =>
    guard(() => runner?.status() ?? ({ state: "never" } as const)),
  );
}

/**
 * `GEODE_SELFTEST=1` drives every channel from the page on load and quits with
 * the result. Without it the contract can only be checked by a human clicking
 * buttons, which means in practice it does not get checked.
 */
const SELFTEST = process.env["GEODE_SELFTEST"] === "1";

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    show: !SELFTEST,
    width: 900,
    height: 680,
    webPreferences: {
      preload: path.join(HERE, "..", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // The renderer's console is otherwise invisible from a terminal, which makes
  // a failing self-test look like a silent hang.
  win.webContents.on("console-message", (_e, _level, message) => {
    process.stdout.write(`${message}\n`);
    if (SELFTEST && message.startsWith("SELFTEST done")) {
      app.exit(message.includes("FAIL") ? 1 : 0);
    }
  });

  const query = SELFTEST ? { search: "selftest" } : {};
  await win.loadFile(path.join(HERE, "..", "renderer", "index.html"), query);

  // A self-test that hangs looks exactly like one that is slow, and the last
  // two times something in this app went wrong it presented as a silent wait.
  if (SELFTEST) {
    setTimeout(() => {
      process.stderr.write("SELFTEST timed out — no report from the renderer\n");
      app.exit(1);
    }, 60_000).unref();
  }
}

void app.whenReady().then(async () => {
  register();
  await createWindow();
});

// Nothing closes the Store for you the way the CLI's `finally` blocks do.
app.on("before-quit", () => {
  store?.close();
  store = null;
});

app.on("window-all-closed", () => app.quit());
