# The Electron app

The second interface. A peer of the CLI, not a replacement for it, and not a wrapper around it — both sit on one `core` and neither imports the other ([ADR 0013](../decisions/0013-cli-and-electron-are-peers.md)).

This document covers what is not obvious from reading the files: where the process boundary is, what crosses it, and the handful of rules that keep a GUI honest about work that takes minutes.

## Where the code runs

```
src/electron/
  ipc.ts              the contract — channel names and wire types, one file
  preload.cts         the only thing the renderer can reach
  main/index.ts       window, protocol, handlers. Owns the Store and the Core
  main/runs.ts        single-flight and the progress throttle. No Electron imports
  main/open.ts        the detached editor spawn. No Electron imports
  renderer/           React. No Node, no Electron, no core
  renderer/model/     the decisions, as pure functions
```

`core` runs in the **main process**, measured rather than assumed ([ADR 0017](../decisions/0017-core-runs-in-the-main-process.md)). The decision rests on `core`'s long operations being chunked, so a change that introduces one long synchronous span invalidates it — `measure.bench.ts` is how you find out.

`main/runs.ts` and `main/open.ts` deliberately import nothing from Electron, which is what lets them be tested under plain vitest against a real `Core` and a real temp vault. Follow that when adding to `main/`: the Electron-shaped part is usually thin, and everything under it is ordinary code.

## Two rules hold the contract together

**Nothing that crosses is a function.** `structuredClone` throws on one, so a callback in a payload is a runtime failure rather than a type error. `core`'s own types cannot be reused for this — `Config.newId` is a function and so is `SyncOptions.onProgress`, and both look like data at a glance. The wire types are therefore deliberately *different types with different names*: `AppConfig`, not `Config`; `SyncRequest`, not `SyncOptions`.

**Nothing throws across the boundary.** Electron's IPC drops an error's prototype and its custom properties, so `instanceof` and `.code` are both worthless on the far side. Every handler returns a `Result`, tagged on the near side by `host/errors.ts` while the error is still itself.

## Long runs

`run/start` is single-flight, and the three cases are not symmetric:

- a second **sync** while a sync is running **joins** it and gets the same `runId` — two windows asking to sync meant one sync, and an error there answers a question nobody asked
- a **rebuild** is refused while anything is running, because `dropAll` is destructive and a joiner would receive a summary for a database it did not expect
- nothing may join a rebuild, for the same reason

This guards *this process only*. A `geode sync` running in a terminal at the same time is fine and is designed for — WAL, the busy timeout, and the re-stat before each write. Do not add a lock file.

### Progress is recorded hot and emitted cold

`onProgress` fires once per enumerated file — including the ones the mtime cache skips, so a million calls at the top of the scale range. The handler does two field writes and nothing else: no clock, no allocation, no send. A timer emits the latest value every 100 ms.

There is a final emit at 100% regardless of the throttle, because a bar that stops at 999,847 of a million looks broken rather than finished.

### Reconcile on mount, do not rely on the event

A five-file sync finishes in milliseconds. A component that mounts and *then* starts a run can miss its own completion, and a window reloaded mid-sync was never subscribed at all. `run/status` therefore answers `running` / `idle` with the last result / `never`, and a screen asks it on mount before subscribing. `renderer/model/run.ts` holds the reconciliation, including the parts that are easy to get wrong:

- a progress event for a **finished** run is ignored — the final emit and the finish event race
- a progress event for an **older** run is ignored — run ids order numerically, because `run-10` sorts before `run-9` as a string
- `dryRun` rides on the events rather than being remembered by whoever started the run, so a window that joined a run cannot claim notes were written when they were not

### There is no cancel, deliberately

`Core` takes no `AbortSignal`, and killing a rebuild halfway leaves an emptied database with nothing to say so. A button that cannot do what it says is worse than its absence. If cancellation is wanted it is a small clean change to `core` — `signal?: AbortSignal` checked at the top of the file loop — made on purpose rather than in a panic.

## First run

The CLI's `init` writes a config, prints two sentences of advice, and exits. A GUI cannot print-and-exit, and the stakes are specific: **the first real sync writes an id comment into every note that contains a card.** On an existing collection that is a diff across the whole tree. `init` can only warn about it; a window can make the number visible before it happens.

The sequence is welcome → confirm the folder → preview the settings → version control → preview the sync → run it, and `renderer/model/setup.ts` holds it as a pure state machine. Three things in there are load-bearing:

- **The real sync is unreachable without a preview.** `canSync` is false until a dry run has completed, and `picked` clears the preview — so choosing a different folder takes it back to false rather than letting the first folder's numbers authorise a sync of the second. That is the bug the model exists to prevent, and it is invisible in a screenshot.
- **`filesStamped` is the number the preview leads with**, not `cardsNew`. One file can hold fifty cards, and the question being asked is *how many of my notes does this rewrite*.
- **An empty folder is a warning, not a refusal.** Starting a collection from nothing is legitimate; pointing at a Downloads folder is the likeliest mistake. The count makes the second visible without blocking the first.

The folder count comes from `host/setup.ts`, which calls the *same* `enumerate` a sync uses — same dotted-directory skip, same `.md` filter, same refusal to follow directory symlinks. A second walk would drift, and a count that disagrees with what then happens is worse than no count. `boundaries.test.ts` forbids either interface from importing `files/` for this reason.

### An existing config is a choice, reached by asking

`initConfig` refuses to overwrite without `force`, and preserves `device` and `editor` even then — regenerating `device` would silently start a second log shard and scatter one machine's history across two names. The app surfaces that as a choice by calling `setup/propose` **before** writing anything, rather than by catching `InitRefused`. Two reasons: an exception is the wrong control flow for an ordinary answer, and the user needs to be *told* what is preserved — a GUI that quietly keeps a field looks like it ignored the question.

### A missing `notesPath` is a repair, not a first run

Routine on a desktop: the folder moved, or a drive is unmounted. Both states reach the app as "no usable collection", and giving them the same screen would greet a year-old user with a welcome page because something is unplugged. `App.tsx` tells them apart by inspecting the configured folder after reading the config, and the same component opens at the folder step with different words.

## What the screens share with the CLI

Anything both interfaces would want lives in `host`, not in whichever one asked for it first — the failure mode is two interfaces that each stay self-consistent while disagreeing, which no test catches:

| In `host` | Why it cannot be per-interface |
|---|---|
| `RATING_KEYS`, `interpretKey` | what `3` does, and whether `escape` quits |
| `resolveEditor`, `editorCommand` | which program `o` opens, and how it is told a line |
| `OpenedNotes` | the mtime-at-open record behind "this note changed" |
| `summaryFields` | which counts a sync reports, and in what order |
| `deferralReason` | why a freshly-edited file was left alone |
| `PHASE_LABEL` | what `scan` / `prune` / `ingest` are called |

What stays per-interface is *drawing*, and one thing that is not drawing: the **spawn**. `cli/` inherits the TTY and awaits the child because a terminal editor holds it; `electron/` detaches and returns at once because a GUI has none to hand over. See [module-map.md](module-map.md).

`boundaries.test.ts` enforces every row of that table by scanning source text.

## The two traps

**The renderer is served over `app://`, not `file://`.** Chromium blocks ES modules on `file://` under its CORS rules and Vite emits a module script, so `loadFile` produces a window that loads and silently does nothing — no error anywhere. A custom scheme has a real origin, so modules load, relative assets resolve, and the CSP in `index.html` means something.

**The preload is CommonJS.** `sandbox: true` rejects an ESM preload, and the sandbox is worth more than the consistency. `.cts` so `tsc` emits `.cjs` regardless of the package type.

## Seeing it

```sh
npm run build:desktop
npm --prefix desktop start                                     # just run it
GEODE_SELFTEST=1 npx electron dist/electron/main/index.js      # headless, exits non-zero on failure
```

The self-test drives every channel against a real database **and** clicks real buttons and presses real keys, because a button wired to the wrong handler passes every API-level check. `console.log("SHOT name")` from the renderer writes `name.png` of the window — the only way to find out whether anything rendered, whether text is legible, or whether a layout collapsed. Screenshots are diagnostic, never fixtures: comparing them byte-for-byte across machines fails on font rendering alone.

Three substitutions keep the harness runnable rather than invasive:

- `o` spawns `touch` instead of the real editor, so a run does not open TextEdit but the end-of-session "this note changed" path still fires
- the rebuild confirmation is asserted without the rebuild being run, because on a real collection that is minutes
- `GEODE_SELFTEST_FOLDER` answers the folder picker, because a native modal has no DOM to click — everything downstream of the pick is driven for real

With no config present and that variable set, the harness drives the whole first-run sequence and then continues into the review checks against the collection it just set up. **It performs a real first sync**, so point it at a copy.
