# 0017 — `core` runs in the Electron main process, and the seam stays

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

`better-sqlite3` has no async API, so every `Store` call blocks whatever process runs it. In a CLI that is invisible — the design docs call it "an invisible pause in a process about to exit". In an Electron **main** process it is different: the renderer keeps painting, so the window looks alive, while the app menu, `dialog`, window creation and **every other IPC channel including a cancel button** stop answering. A frozen window at least reads as busy; a responsive window that ignores you reads as broken.

The obvious remedy is to run `core` in a `utilityProcess`, and the plan for this phase chose exactly that. It chose it **on argument, having never measured**, which is the same footing that produced two wrong numbers earlier in this project: the enumeration speedup that did not reproduce, and a cold-cache cost predicted to be "an order of magnitude worse" that measured 1.09×.

So this decision was deferred until there was a number.

## Decision

**`core` runs in the main process.** No utility process.

**The seam stays.** `src/electron/protocol.ts` defines the command and reply shapes that main implements directly today. Nothing crossing it is a function, a class instance, or anything else `structuredClone` would reject — so moving `core` behind a port later is a transport swap rather than a restructure, in the same spirit as [ADR 0011](0011-enumeration-is-a-seam.md).

## The measurement

Worst main-process event-loop stall, sampled by a 20 ms interval, on a vault of **1,000 files × 20 cards = 20,000 cards** with **8,000 reviews** in the log. Electron 33.4.11, Node 20.18.3.

| operation | core in main | utilityProcess |
|---|---|---|
| `sync --full` | **1.0 ms** | 10.2 ms |
| 4,000 ratings (an `fsync` each) | **6.1 ms** | 10.4 ms |
| `rebuild`, replaying 8,000 reviews | **1.3 ms** | 10.1 ms |

**Zero dropped frames in any cell.** A frame is 16 ms.

Three things this table does *not* say, and each matters:

**The utilityProcess column is unfair to it.** That ~10 ms is process *spawn*, and the harness forks a worker per operation. A real app spawns once at launch. The honest reading is not "main wins" but "both are comfortably sufficient at this scale."

**`sync` was never the interesting case.** It is short synchronous chunks separated by real awaits — `files.readFile`, `files.writeIfUnchanged` — so the loop breathes between files. The argument for a second process rested on `rebuild` and on first-ingest replay, which is why those were measured rather than sync alone. An earlier run measured `rebuild` *before* anything had been reviewed and therefore measured the cheap half of it; the table above reorders so the log exists first.

**This is not extrapolated to the million-card design target.** Fifty times the data is not fifty times the stall in any way that has been measured, and extrapolating is exactly how the walk figures in [ADR 0008](0008-incremental-sync-costs-what-changed.md) went wrong.

## Consequences

- **Complexity is not bought on speculation.** A second process means a lifecycle, crash and respawn handling, a second IPC hop, and progress relayed twice. [ADR 0011](0011-enumeration-is-a-seam.md) refuses a watcher on the same grounds — a real dependency needs a real number behind it.
- **The main process must still never block on anything unbounded.** This decision rests on `core`'s current shape, in which the long operations are chunked. Code that introduces one long synchronous span — a whole-file `readFileSync`, an unchunked transaction over every row — invalidates it. That is why the `readFileSync` in `idIsInFile` was removed before this phase rather than during it.
- **Re-measure before the vault grows an order of magnitude**, and before shipping to anyone whose collection is much larger than the one measured. `src/electron/measure.ts` is kept for exactly that, alongside `enumerate.bench.test.ts`, as a measurement that decides an open question rather than guarding an invariant.
- If the number ever stops being acceptable, the move is already specified: implement `protocol.ts` over a `MessagePort` into a `utilityProcess`. The worker in `src/electron/worker/` is retained as the working proof that it runs — including that `better-sqlite3` loads under Electron's ABI from `desktop/node_modules`.

## What the spike also settled

Two build facts that would have derailed a later milestone, found by running rather than reasoning:

- **Node resolves `node_modules` by walking up from the importing file.** Compiled output at `dist/electron/…` finds the *root*, Node-ABI copy of `better-sqlite3` and dies with `NODE_MODULE_VERSION 141 … requires 130`. The Electron build therefore emits to `desktop/dist/`, so the walk reaches `desktop/node_modules` first. Two builds of one source for two runtimes.
- **`npm install` in `desktop/` is not enough** — it builds the native module against local Node. It needs `electron-rebuild` as a separate, documented step, because the failure mode is every `Store` call dying at `new Database`.

Both are recorded in `desktop/README.md`.
