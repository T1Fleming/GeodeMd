/**
 * Public API. Section 6: `index.ts` re-exports `core`, which is what the
 * Electron phase imports. Nothing here reaches into `cli`.
 */
export { Core, ConfigError } from "./core/index.js";
export type { Config, DueCard, SyncOptions, SyncSummary } from "./core/index.js";
export { Store } from "./store/index.js";
export type { CardState } from "./store/index.js";
export { FsrsScheduler, FSRS_PARAMS, fold } from "./scheduler/index.js";
export type { Scheduler } from "./scheduler/index.js";
export { parse, parseLine, stampLine, splitLines, ID_PATTERN } from "./parser/index.js";
export type { ParsedCard } from "./parser/index.js";
