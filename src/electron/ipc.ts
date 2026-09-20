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

/** The config as it crosses — `core`'s `Config` carries a function. */
export interface AppConfig {
  notesPath: string;
  device: string;
  dbPath: string;
  editor?: string;
}

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
}

/**
 * A rating always succeeds if the log write did, because the log is written
 * before the database. `log-only` means SQLite was busy and the next ingest
 * will reconcile — a dim note, never a dialog.
 */
export interface Rated {
  applied: "db" | "log-only";
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
 * The markdown count is the check `geode init` cannot make: pointing at a
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
 * `preserved` exists so the app can *say* that `device` and `editor` are kept
 * across a replace. The preservation itself is already right in `initConfig`;
 * what a GUI adds is telling the user, because silently keeping a field looks
 * like the question was ignored.
 */
export interface ConfigProposal {
  notesPath: string;
  device: string;
  dbPath: string;
  replaces: AppConfig | null;
  preserved: Array<"device" | "editor">;
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
  setupPick: "geode:setup/pick",
  setupInspect: "geode:setup/inspect",
  setupPropose: "geode:setup/propose",
  setupWrite: "geode:setup/write",
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
   * Open the OS folder chooser. Null when the user cancelled — which is an
   * ordinary answer, not a failure, and must not look like one.
   */
  setupPick(): Promise<Result<string | null>>;
  setupInspect(folder: string): Promise<Result<FolderReport>>;
  setupPropose(folder: string): Promise<Result<ConfigProposal>>;
  /**
   * Write the config. `replace` must be passed explicitly to overwrite an
   * existing one — the refusal is the same one `geode init` makes without
   * `--force`, surfaced as a choice rather than an error.
   */
  setupWrite(folder: string, replace: boolean): Promise<Result<AppConfig>>;
  onRunProgress(fn: (p: RunProgress) => void): () => void;
  onRunFinished(fn: (f: RunFinished) => void): () => void;
}
