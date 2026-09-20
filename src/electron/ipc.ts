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
}

export interface RunFinished {
  runId: string;
  kind: "sync" | "rebuild";
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
  onRunProgress(fn: (p: RunProgress) => void): () => void;
  onRunFinished(fn: (f: RunFinished) => void): () => void;
}
