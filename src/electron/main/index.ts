/**
 * The Electron main process. Owns the window, the `Store`, and the `Core`.
 *
 * `core` runs here rather than in a utility process — measured, not assumed;
 * see ADR 0017. The decision rests on `core`'s long operations being chunked,
 * so a change that introduces one long synchronous span invalidates it and the
 * bench in `measure.bench.ts` is how you find out.
 */

import { app, BrowserWindow, ipcMain, net, protocol } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Core } from "../../core/index.js";
import type { Store } from "../../store/index.js";
import type { FileConfig } from "../../host/config.js";
import { OpenedNotes, resolveEditor } from "../../host/editor.js";
import { classify, isBusy } from "../../host/errors.js";
import { openCore, readAppConfig } from "../../host/open.js";
import { CH } from "../ipc.js";
import type { AppConfig, NoteOpened, Rated, Result, Stats, SyncRequest } from "../ipc.js";
import { openDetached } from "./open.js";
import { Runner } from "./runs.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let core: Core | null = null;
let store: Store | null = null;
let runner: Runner | null = null;
let win: BrowserWindow | null = null;
let config: FileConfig | null = null;
/**
 * Kept beside the Core rather than in the renderer: the renderer cannot stat a
 * file, and it is the mtime at open time — not the path — that makes the
 * end-of-session answer possible.
 */
let opened: OpenedNotes | null = null;

/**
 * Lazily, on the first command that needs it — never at startup. On a first run
 * there is no config and therefore no dbPath, and opening a database at a path
 * nobody chose is how a stray db.sqlite appears in someone's home directory.
 */
async function ensureCore(): Promise<Core> {
  if (core) return core;
  const c = await readAppConfig();
  if (!c) throw new NoConfig();
  config = c;
  opened = new OpenedNotes(c.notesPath);
  const it = openCore(c);
  core = it.core;
  store = it.store;
  runner = new Runner({
    core: it.core,
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

  /**
   * Open the note a card was written in — the app's half of `o`.
   *
   * `ensureCore` first, for the config rather than the Core: the notes path
   * and the `editor` setting both live there, and a first run has neither.
   *
   * A failure crosses as `ok: false` and is tagged `config`, not `internal`:
   * "you have no editor installed" is something the user fixes by setting one,
   * and `internal` means a bug. Either way it is a message the renderer shows
   * as a dim note — the session survives an editor that will not start.
   */
  ipcMain.handle(CH.noteOpen, async (_e, filePath: string, line: number | null) => {
    const r = await guard<Result<NoteOpened>>(async () => {
      await ensureCore();
      const c = config!;
      // Resolve, then check the prefix. `filePath` comes from a card row and is
      // relative by construction, but a stored `..` must not be able to reach
      // out of the notes directory and hand an arbitrary file to a spawn.
      const root = path.resolve(c.notesPath);
      const abs = path.resolve(root, filePath);
      if (!abs.startsWith(root + path.sep)) {
        return { ok: false, kind: "config", message: `${filePath} is outside your notes folder` };
      }
      // Recorded before the spawn: afterwards the editor may already have
      // touched the file, and the baseline would be the edited mtime.
      await opened!.opened(filePath);
      const editor = SELFTEST ? SELFTEST_EDITOR : resolveEditor(c.editor, process.env);
      const result = await openDetached(abs, line, editor);
      if (result.launched) return { ok: true, value: { launched: true } };
      return { ok: false, kind: "editor", message: result.message ?? "could not open the note" };
    });
    // Two Results: the guard's, which catches a missing config, and this
    // handler's own. Unwrap rather than nest — the same shape as run/start.
    return r.ok ? r.value : r;
  });

  /**
   * Which opened notes changed. Asked once, at the end of a session — see
   * `OpenedNotes` for why not sooner.
   */
  ipcMain.handle(CH.noteChanged, (_e, filePaths: string[]) =>
    guard<string[]>(async () => (opened ? opened.changed(filePaths) : [])),
  );
}

/**
 * `GEODE_SELFTEST=1` drives every channel from the page on load and quits with
 * the result. Without it the contract can only be checked by a human clicking
 * buttons, which means in practice it does not get checked.
 */
const SELFTEST = process.env["GEODE_SELFTEST"] === "1";

/**
 * What `o` runs under the self-test.
 *
 * The harness presses `o` for real, which is the point — a handler bound to
 * the wrong thing passes every channel-level check. Resolving the real editor
 * would launch whatever owns `.md` on that machine, and a test suite that
 * opens TextEdit is one people stop running.
 *
 * `touch` rather than `true` because it stands in for the editor's *effect*:
 * it bumps the mtime and exits, which is what makes the end-of-session "this
 * note changed" path reachable from the harness at all. Nothing appears on
 * screen and no content is written — a smaller footprint than the real review
 * this same run records in the log.
 */
const SELFTEST_EDITOR = "touch";

/**
 * Where `SHOT` writes. Defaults next to the build so a stray run cannot
 * scatter PNGs across someone's home directory.
 */
const SHOT_DIR = process.env["GEODE_SHOT_DIR"] ?? path.join(HERE, "..", "..", "shots");

const pendingShots: Array<Promise<void>> = [];

async function captureTo(name: string): Promise<void> {
  if (!win) return;
  try {
    const image = await win.webContents.capturePage();
    await mkdir(SHOT_DIR, { recursive: true });
    const file = path.join(SHOT_DIR, `${name}.png`);
    await writeFile(file, image.toPNG());
    process.stdout.write(`SHOT saved ${file}\n`);
  } catch (err) {
    process.stderr.write(`SHOT failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

/**
 * The renderer is served from `app://` rather than `file://`.
 *
 * Not a preference. Vite emits `<script type="module">`, and Chromium blocks
 * ES modules on `file://` under its CORS rules — the page loads and silently
 * does nothing, with no error anywhere. A custom scheme has a real origin, so
 * modules load, relative assets resolve, and the CSP in index.html means
 * something.
 */
const RENDERER = path.join(HERE, "..", "renderer");

function serveRenderer(): void {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    // Confined to the renderer directory: a crafted path must not be able to
    // read the rest of the disk through this handler.
    const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    const file = path.join(RENDERER, rel === "" ? "index.html" : rel);
    if (!file.startsWith(RENDERER)) return new Response("no", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    show: !SELFTEST,
    // A hidden window still has to paint, or capturePage returns nothing.
    // This is the default, but it is load-bearing here and silent when wrong.
    paintWhenInitiallyHidden: true,
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

    // `SHOT <name>` writes a PNG of the window.
    //
    // The self-test can prove data arrived; it cannot tell whether anything
    // rendered, whether the text is legible, or whether the layout collapsed.
    // For a contract that was fine. For a review screen — which is mostly a
    // claim about how it looks — it is not, and a picture is the only way to
    // check from outside the app.
    if (message.startsWith("SHOT ")) {
      const name = message.slice(5).trim().replace(/[^a-zA-Z0-9._-]/g, "_");
      pendingShots.push(captureTo(name));
      return;
    }

    if (SELFTEST && message.startsWith("SELFTEST done")) {
      // Let in-flight captures finish before the process goes away, or the
      // last screenshot is a zero-byte file.
      void Promise.all(pendingShots).then(() => app.exit(message.includes("FAIL") ? 1 : 0));
    }
  });

  await win.loadURL(`app://local/index.html${SELFTEST ? "?selftest" : ""}`);

  // A self-test that hangs looks exactly like one that is slow, and the last
  // two times something in this app went wrong it presented as a silent wait.
  if (SELFTEST) {
    setTimeout(() => {
      process.stderr.write("SELFTEST timed out — no report from the renderer\n");
      app.exit(1);
    }, 60_000).unref();
  }
}

// Must be called before the app is ready, and before any window exists.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

void app.whenReady().then(async () => {
  serveRenderer();
  register();
  await createWindow();
});

// Nothing closes the Store for you the way the CLI's `finally` blocks do.
app.on("before-quit", () => {
  store?.close();
  store = null;
});

app.on("window-all-closed", () => app.quit());
