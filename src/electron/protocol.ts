/**
 * The main ↔ worker message shapes, in one file so both ends cannot drift.
 *
 * Everything here must survive `structuredClone`: no functions, no class
 * instances. That rules out `Config` (its `newId` is a function) and
 * `SyncOptions` (its `onProgress` is one) — the worker builds those locally
 * from the plain fields below.
 */

import type { SyncSummary } from "../core/index.js";

export interface Stats {
  total: number;
  dueNow: number;
  dueBeforeMidnight: number;
  newCards: number;
}

export type WorkerCommand =
  | { t: "stats"; id: number; configFile?: string }
  | { t: "sync"; id: number; configFile?: string; full?: boolean }
  | { t: "rebuild"; id: number; configFile?: string; full?: boolean }
  | { t: "reviews"; id: number; configFile?: string; full?: boolean }
  | { t: "shutdown"; id: number };

export type WorkerReply =
  | { t: "stats"; id: number; value: Stats }
  | { t: "sync"; id: number; value: SyncSummary }
  | { t: "rebuild"; id: number; value: SyncSummary }
  | { t: "reviews"; id: number; value: number }
  | { t: "shutdown"; id: number }
  | { t: "error"; id: number; message: string };
