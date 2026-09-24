/**
 * Public API. Section 6: `index.ts` re-exports `core`, which is what the
 * Electron phase imports. The app is the only interface (ADR 0025).
 */
export { Core, ConfigError } from "./core/index.js";
export type { Config, DueCard, SyncOptions, SyncSummary } from "./core/index.js";
export { Store } from "./store/index.js";
export type { CardState } from "./store/index.js";
export { FsrsScheduler, FSRS_PARAMS, fold } from "./scheduler/index.js";
export type { Scheduler } from "./scheduler/index.js";
export { parse, parseLine, stampLine, splitLines, ID_PATTERN } from "./parser/index.js";
export type { ParsedCard } from "./parser/index.js";
