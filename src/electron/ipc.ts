/**
 * The contract between the renderer and the rest of the app. One file, so the
 * two ends cannot drift.
 *
 * Two rules hold everything here together.
 *
 * **Nothing that crosses is a function.** Not because a function would be
 * inconvenient, but because `structuredClone` throws on one, so a callback in a
 * payload is a runtime failure rather than a type error. `core`'s own types
 * cannot be reused for this: `Config.newId` is a function and so is
 * `SyncOptions.onProgress`, and both look like data at a glance. The wire types
 * below are therefore deliberately *different types with different names* —
 * `AppConfig`, not `Config`; `SyncRequest`, not `SyncOptions` — so a later
 * refactor cannot quietly make the wrong one the payload.
 *
 * **Nothing throws across the boundary.** Electron's IPC drops an error's
 * prototype and its custom properties, so `instanceof` and `.code` are both
 * worthless on the far side. Every handler returns a `Result` instead, tagged
 * on the near side by `host/errors.ts` while the error is still itself.
 *
 * `core` currently runs in the main process (ADR 0017), so these types do not
 * literally cross a process boundary today. They are written as if they do,
 * because that is what keeps the move available.
 */

import type { ErrorKind } from "../host/errors.js";
import type { SyncPhase, SyncSummary, DueCard } from "../core/index.js";

export type { ErrorKind, SyncPhase, SyncSummary, DueCard };

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; kind: ErrorKind; message: string };

/**
 * The active vault as it crosses — `core`'s `Config` carries a function.
 * `id` and `name` are the vault's ([ADR 0027](../../docs/decisions/0027-vaults.md)).
 */
export interface AppConfig {
  id: string;
  name: string;
  notesPath: string;
  device: string;
  dbPath: string;
  editor?: string;
}

/** One vault in the list: a notes folder and its own database. */
export interface VaultInfo {
  id: string;
  name: string;
  notesPath: string;
  dbPath: string;
}

/** What `vaults/list` answers: every vault, and which one is open. */
export interface VaultList {
  active: string;
  vaults: VaultInfo[];
}

/**
 * What switching (or adding, or re-pointing) answers.
 *
 * `left` is the end-of-session check for the vault that was just closed. A
 * review session interrupted by a switch never reaches its own, and after the
 * switch the notes it opened can no longer be asked about — so the answer is
 * computed on the way out and carried here. Null when nothing was open.
 */
export interface VaultSwitched {
  config: AppConfig;
  left: { vault: string; changed: string[] } | null;
}

/**
 * What opening the active vault took — today, only whether its schedules had
 * to be re-derived because the scheduler changed (ADR 0028).
 *
 * Facts rather than a sentence: the words are `host/present.ts`'s
 * `rescheduledText`, like every other summary the app shows.
 */
export interface VaultOpened {
  rescheduled: { cards: number } | null;
}

/** Why a folder is being picked, which decides the dialog's words. */
export type PickPurpose = "first" | "repair" | "change" | "add";

/** The sync options that cross — `SyncOptions` carries `onProgress`. */
export interface SyncRequest {
  full: boolean;
  dryRun: boolean;
}

export interface Stats {
  total: number;
  dueNow: number;
  dueBeforeMidnight: number;
  newCards: number;
  /** A due count stopped at `COUNT_CAP`, so the due figures are floors (ADR 0024). */
  capped: boolean;
}

/**
 * A rating always succeeds if the log write did, because the log is written
 * before the database. `log-only` means SQLite was busy and the next ingest
 * will reconcile — a dim note, never a dialog.
 */
export interface Rated {
  applied: "db" | "log-only";
  /**
   * The card's new due time and state, or null when they are not known.
   *
   * The session needs this to honour FSRS's short-term steps: a new card rated
   * anything but *easy* is due again in one to ten minutes and comes back in
   * the same sitting (ADR 0023). Facts rather than a verdict — whether those
   * facts mean "again today" is `host/queue.ts`'s to answer, so the renderer
   * and the CLI cannot come to different conclusions from the same rating.
   *
   * Null on `log-only`: the rating is in the log, but the state that the
   * database refused to hold was never computed on this side of the failure.
   * One lost re-show, no lost review.
   */
  next: { due: string; state: number } | null;
}

/**
 * What `note/open` answers.
 *
 * A `Result`, and `launched` inside it, so a missing editor is a message the
 * renderer can show as a dim note rather than a thrown error — the same
 * treatment a busy database gets. Failing to open a note must never cost the
 * user the session.
 */
export interface NoteOpened {
  launched: boolean;
}

/**
 * What the folder the user picked actually contains.
 *
 * The markdown count is the check writing a config cannot make: pointing at a
 * Downloads folder, or at the parent of the notes, is the likeliest first-run
 * mistake and the counts are how it becomes visible. A **soft** signal — an
 * empty folder is a fine place to start writing cards.
 */
export interface FolderReport {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  markdownFiles: number;
  isGitRepo: boolean;
  symlinkedDirs: number;
}

/**
 * What writing a config for this folder would produce, and what it replaces.
 *
 * `point` re-points the active vault (a first run, a repair, Change folder…);
 * `add` makes a new vault with its own database, whose id is `vault` — passed
 * back to `vaults/add` so the database path shown is the one written.
 *
 * `preserved` exists so the app can *say* that `device` and `editor` are kept
 * across a replace. The preservation itself is already right in `initConfig`;
 * what a GUI adds is telling the user, because silently keeping a field looks
 * like the question was ignored.
 */
export interface ConfigProposal {
  mode: "point" | "add";
  notesPath: string;
  device: string;
  dbPath: string;
  vault: string;
  replaces: AppConfig | null;
  preserved: Array<"device" | "editor">;
}

/**
 * What `editors/list` answers: the GUI editors installed here, and what the
 * config currently says.
 *
 * `current` is the config's own `editor` key, null for the system default.
 * It may name something that is not in `detected` — a typed command, or an
 * editor since uninstalled — and which option shows as chosen then is
 * `renderer/model/editor.ts`'s to decide.
 */
export interface EditorChoices {
  detected: Array<{ command: string; label: string }>;
  current: string | null;
}

export interface RunStarted {
  runId: string;
  /** True when an identical run was already in flight and this joined it. */
  joined: boolean;
}

export interface RunProgress {
  runId: string;
  kind: "sync" | "rebuild";
  phase: SyncPhase;
  done: number;
  total: number;
  /**
   * Carried on the event rather than remembered by whoever started the run.
   *
   * A window that reloads mid-sync, or a second window that joined one, learns
   * about the run entirely from `run/status` and these events. Without this it
   * would have to guess, and the guess it would make — "a run I did not start
   * is a real one" — is the one that tells the user their notes were rewritten
   * when they were not.
   */
  dryRun: boolean;
}

export interface RunFinished {
  runId: string;
  kind: "sync" | "rebuild";
  dryRun: boolean;
  result: Result<SyncSummary>;
}

/**
 * What `run/status` answers.
 *
 * `last` exists because an event is only useful to whoever was already
 * listening. A five-file sync finishes in milliseconds, so a component that
 * mounts and then starts a run can miss its own completion — and a window
 * reloaded mid-sync would never learn the outcome at all. Keeping the most
 * recent result queryable is what lets a UI reconcile on mount rather than
 * having to be subscribed before anything happens.
 *
 * `last` is replaced when the next run starts, not aged out: "the most recent
 * run" is a fact about the process, and inventing a expiry would mean a UI
 * that renders differently depending on how long the user looked away.
 */
export type RunStatus =
  | { state: "running"; progress: RunProgress }
  | { state: "idle"; last: RunFinished }
  | { state: "never" };

/**
 * Channel names live here and nowhere else. A literal typed a second time in
 * main and in the preload is a bug that type-checks.
 */
export const CH = {
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
  // Events, main → renderer.
  runProgress: "geode:run/progress",
  runFinished: "geode:run/finished",
} as const;

/** What the preload exposes on `window.geode`. */
export interface GeodeApi {
  configRead(): Promise<Result<AppConfig | null>>;
  statsRead(): Promise<Result<Stats>>;
  cardsDue(limit: number): Promise<Result<DueCard[]>>;
  cardsReview(cardId: string, rating: 1 | 2 | 3 | 4): Promise<Result<Rated>>;
  runStart(kind: "sync" | "rebuild", req: SyncRequest): Promise<Result<RunStarted>>;
  runStatus(): Promise<Result<RunStatus>>;
  /** Open a card's note. `filePath` is relative to notesPath, as stored. */
  noteOpen(filePath: string, line: number | null): Promise<Result<NoteOpened>>;
  /**
   * Which of the notes opened this session have changed since they were
   * opened. Asked once at the end: a GUI editor returns long before anything
   * has been typed, so asking sooner reports nothing (ADR 0012).
   */
  noteChanged(filePaths: readonly string[]): Promise<Result<string[]>>;
  /**
   * A card's annotation, or null when it has none ([ADR
   * 0029](../../docs/decisions/0029-annotations.md)). Asked when a card is
   * revealed, for the marker, and never at the question.
   */
  annotationGet(cardId: string): Promise<Result<string | null>>;
  /**
   * Write a card's annotation into the vault named by `vault`; blank text
   * removes it.
   *
   * `vault` is the vault the text was written in, and main refuses the write
   * if another one is open by now. A review that is closed with the box open
   * saves on the way out, and after a vault switch that would otherwise land
   * the annotation in the wrong notes folder.
   */
  annotationSet(vault: string, cardId: string, text: string): Promise<Result<void>>;
  /**
   * Open the OS folder chooser. Null when the user cancelled — which is an
   * ordinary answer, not a failure, and must not look like one.
   */
  setupPick(purpose: PickPurpose): Promise<Result<string | null>>;
  setupInspect(folder: string): Promise<Result<FolderReport>>;
  setupPropose(folder: string, mode: "point" | "add"): Promise<Result<ConfigProposal>>;
  /**
   * Write the config, pointing the active vault at `folder`. `replace` must be
   * passed explicitly to overwrite an existing one — the refusal is the same
   * one a config writer makes without `--force`, surfaced as a choice rather
   * than an error.
   */
  setupWrite(folder: string, replace: boolean): Promise<Result<VaultSwitched>>;
  /**
   * Which vault this folder would overlap, as a sentence, or null. Asked at
   * the folder step so a refusal is shown before anything is written.
   */
  setupOverlap(folder: string, mode: "point" | "add"): Promise<Result<string | null>>;
  vaultsList(): Promise<Result<VaultList>>;
  /** Add a vault at `folder` and switch to it. `id` is the proposal's. */
  vaultsAdd(folder: string, id: string): Promise<Result<VaultSwitched>>;
  /**
   * Open another vault. Refused, with a reason, while a sync or rebuild is
   * running — the Store is never closed under a job.
   */
  vaultsSwitch(id: string): Promise<Result<VaultSwitched>>;
  vaultsRename(id: string, name: string): Promise<Result<VaultList>>;
  /**
   * Take a vault out of the list. Its notes and log are never touched;
   * `deleteDatabase` also deletes its cache. The open vault cannot be removed.
   */
  vaultsRemove(id: string, deleteDatabase: boolean): Promise<Result<VaultList>>;
  /**
   * Open the active vault now, rather than on the first read, and say what
   * that took. Asked once each time the app arrives at a vault, so a
   * re-derived schedule is announced before the queue it changed is shown —
   * and only then: the answer is handed over once.
   */
  vaultsOpen(): Promise<Result<VaultOpened>>;
  /**
   * Open a link in the user's browser.
   *
   * The Help window renders documentation written for GitHub, so it contains
   * links to things that are not bundled. Navigating the `app://` page to one
   * would leave the user in a broken window with no way back.
   */
  linkOpen(href: string): Promise<Result<void>>;
  editorsList(): Promise<Result<EditorChoices>>;
  /**
   * What `o` opens a note in. A plain command name, never a path — see
   * `launchCommand` in `host/editor.ts`. Null is the system default.
   */
  editorsSet(editor: string | null): Promise<Result<EditorChoices>>;
  onRunProgress(fn: (p: RunProgress) => void): () => void;
  onRunFinished(fn: (f: RunFinished) => void): () => void;
}
