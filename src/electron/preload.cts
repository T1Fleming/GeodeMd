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
  noteOpen: "geode:note/open",
  noteChanged: "geode:note/changed",
  annotationGet: "geode:annotation/get",
  annotationSet: "geode:annotation/set",
  setupPick: "geode:setup/pick",
  setupInspect: "geode:setup/inspect",
  setupPropose: "geode:setup/propose",
  setupWrite: "geode:setup/write",
  setupOverlap: "geode:setup/overlap",
  vaultsList: "geode:vaults/list",
  vaultsAdd: "geode:vaults/add",
  vaultsSwitch: "geode:vaults/switch",
  vaultsRename: "geode:vaults/rename",
  vaultsRemove: "geode:vaults/remove",
  vaultsOpen: "geode:vaults/open",
  linkOpen: "geode:link/open",
  editorsList: "geode:editors/list",
  editorsSet: "geode:editors/set",
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
  noteOpen: (filePath: string, line: number | null) =>
    ipcRenderer.invoke(CH.noteOpen, filePath, line),
  noteChanged: (filePaths: readonly string[]) =>
    // A plain array crosses; a readonly one is the same object to
    // `structuredClone`, and the annotation is only about this side.
    ipcRenderer.invoke(CH.noteChanged, [...filePaths]),
  annotationGet: (cardId: string) => ipcRenderer.invoke(CH.annotationGet, cardId),
  annotationSet: (vault: string, cardId: string, text: string) =>
    ipcRenderer.invoke(CH.annotationSet, vault, cardId, text),
  setupPick: (purpose: string) => ipcRenderer.invoke(CH.setupPick, purpose),
  setupInspect: (folder: string) => ipcRenderer.invoke(CH.setupInspect, folder),
  setupPropose: (folder: string, mode: string) => ipcRenderer.invoke(CH.setupPropose, folder, mode),
  setupWrite: (folder: string, replace: boolean) =>
    ipcRenderer.invoke(CH.setupWrite, folder, replace),
  setupOverlap: (folder: string, mode: string) => ipcRenderer.invoke(CH.setupOverlap, folder, mode),
  vaultsList: () => ipcRenderer.invoke(CH.vaultsList),
  vaultsAdd: (folder: string, id: string) => ipcRenderer.invoke(CH.vaultsAdd, folder, id),
  vaultsSwitch: (id: string) => ipcRenderer.invoke(CH.vaultsSwitch, id),
  vaultsRename: (id: string, name: string) => ipcRenderer.invoke(CH.vaultsRename, id, name),
  vaultsRemove: (id: string, deleteDatabase: boolean) =>
    ipcRenderer.invoke(CH.vaultsRemove, id, deleteDatabase),
  vaultsOpen: () => ipcRenderer.invoke(CH.vaultsOpen),
  linkOpen: (href: string) => ipcRenderer.invoke(CH.linkOpen, href),
  editorsList: () => ipcRenderer.invoke(CH.editorsList),
  editorsSet: (editor: string | null) => ipcRenderer.invoke(CH.editorsSet, editor),
  onRunProgress: (fn: (p: unknown) => void) => on(CH.runProgress, fn),
  onRunFinished: (fn: (f: unknown) => void) => on(CH.runFinished, fn),
});
