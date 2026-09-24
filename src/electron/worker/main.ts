/**
 * The utility process: the ONLY place `better-sqlite3` is loaded when the app
 * runs. It owns the `Store` and the `Core`, and every blocking call happens
 * here so the main process stays able to answer a menu click.
 *
 * Milestone 1 scope: enough to measure, not enough to ship. Two commands.
 */

import { COUNT_CAP } from "../../host/present.js";
import { openCore, readAppConfig } from "../../host/open.js";
import type { Core } from "../../core/index.js";
import type { Store } from "../../store/index.js";
import type { WorkerCommand, WorkerReply } from "../protocol.js";

let core: Core | null = null;
let store: Store | null = null;

/**
 * Lazily, on the first command that needs it — never at startup. On a first
 * run there is no config and therefore no dbPath, and opening a database at a
 * path nobody chose is how you get a stray db.sqlite in someone's home
 * directory.
 */
async function ensureOpen(configFile?: string): Promise<{ core: Core; store: Store }> {
  if (core && store) return { core, store };
  const config = await readAppConfig(configFile);
  if (!config) throw new Error("no config");
  const opened = openCore(config);
  core = opened.core;
  store = opened.store;
  return opened;
}

async function handle(cmd: WorkerCommand): Promise<WorkerReply> {
  switch (cmd.t) {
    case "stats": {
      const { core: c } = await ensureOpen(cmd.configFile);
      return { t: "stats", id: cmd.id, value: c.stats(new Date(), COUNT_CAP) };
    }
    case "sync": {
      const { core: c } = await ensureOpen(cmd.configFile);
      const summary = await c.sync(new Date(), { full: cmd.full ?? false });
      return { t: "sync", id: cmd.id, value: summary };
    }
    case "rebuild": {
      const { core: c } = await ensureOpen(cmd.configFile);
      return { t: "rebuild", id: cmd.id, value: await c.rebuild(new Date()) };
    }
    case "reviews": {
      const { core: c } = await ensureOpen(cmd.configFile);
      const due = c.getDueCards(new Date(), 4000);
      for (const card of due) await c.reviewCard(card.id, 3, new Date());
      return { t: "reviews", id: cmd.id, value: due.length };
    }
    case "shutdown": {
      store?.close();
      store = null;
      core = null;
      return { t: "shutdown", id: cmd.id };
    }
  }
}

process.parentPort?.on("message", (e: { data: WorkerCommand }) => {
  const cmd = e.data;
  void handle(cmd).then(
    (reply) => process.parentPort!.postMessage(reply),
    (err: unknown) => {
      // Classified here, on the near side, while the error still has its
      // prototype and its `.code` — neither survives the wire.
      process.parentPort!.postMessage({
        t: "error",
        id: cmd.id,
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerReply);
    },
  );
});
