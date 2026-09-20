/**
 * The only thing the renderer can reach.
 *
 * CommonJS on purpose, and it is why there is a second tsconfig: an ESM preload
 * requires `sandbox: false`, and the sandbox is worth more than the
 * consistency. `.cts` so `tsc` emits `.cjs` regardless of the package type.
 *
 * Every method returns a `Result` and nothing throws, so the renderer never
 * needs a try/catch and never sees an error whose type has been stripped by
 * serialization.
 */

// `import x = require(...)`, not an ESM import: this file really is CommonJS,
// and `verbatimModuleSyntax` is right to reject the other form here.
import electron = require("electron");
const { contextBridge, ipcRenderer } = electron;

const CH = {
  configRead: "geode:config/read",
  statsRead: "geode:stats/read",
  cardsDue: "geode:cards/due",
  cardsReview: "geode:cards/review",
  runStart: "geode:run/start",
  runStatus: "geode:run/status",
  runProgress: "geode:run/progress",
  runFinished: "geode:run/finished",
} as const;

/**
 * Subscriptions return their own unsubscribe. A renderer that re-subscribes on
 * every render otherwise leaks listeners until Electron warns, and the warning
 * arrives long after the cause.
 */
function on<T>(channel: string, fn: (payload: T) => void): () => void {
  const wrapped = (_e: unknown, payload: T): void => fn(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("geode", {
  configRead: () => ipcRenderer.invoke(CH.configRead),
  statsRead: () => ipcRenderer.invoke(CH.statsRead),
  cardsDue: (limit: number) => ipcRenderer.invoke(CH.cardsDue, limit),
  cardsReview: (cardId: string, rating: number) =>
    ipcRenderer.invoke(CH.cardsReview, cardId, rating),
  runStart: (kind: string, req: unknown) => ipcRenderer.invoke(CH.runStart, kind, req),
  runStatus: () => ipcRenderer.invoke(CH.runStatus),
  onRunProgress: (fn: (p: unknown) => void) => on(CH.runProgress, fn),
  onRunFinished: (fn: (f: unknown) => void) => on(CH.runFinished, fn),
});
