# The Electron app

The interface. It sits on one `core` and reaches nothing below `host` ([ADR 0025](../decisions/0025-the-app-is-the-only-interface.md) removed the CLI, which had been its peer; the boundaries it left behind are why that removal touched nothing under `src/electron/`).

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

`core` runs in the **main process**, measured rather than assumed ([ADR 0017](../decisions/0017-core-runs-in-the-main-process.md)), and re-measured at ten and fifty times that collection ([ADR 0024](../decisions/0024-remeasure-the-main-process-stall.md)). The decision rests on `core`'s long operations being chunked, so a change that introduces one long synchronous span invalidates it — `src/measure/bench.ts` is how you find out, and `src/measure/vault.ts` builds a collection big enough to ask.

What ADR 0024 changed, and what it left: every count that can grow without bound stops at `COUNT_CAP`, because `stats` — the Vault tab, which nobody thinks of as expensive — cost 632 ms at a million cards; `sync` folds the WAL back in before returning, so the first rating of a session does not pay for it. `rebuild` still stalls the loop for ~240 ms at a time, and that is accepted: it is modal, it offers no cancel, and nothing else in the window does anything while it runs.

`main/runs.ts`, `main/active.ts` and `main/open.ts` deliberately import nothing from Electron, which is what lets them be tested under plain vitest against a real `Core` and a real temp vault. Follow that when adding to `main/`: the Electron-shaped part is usually thin, and everything under it is ordinary code.

## Two rules hold the contract together

**Nothing that crosses is a function.** `structuredClone` throws on one, so a callback in a payload is a runtime failure rather than a type error. `core`'s own types cannot be reused for this — `Config.newId` is a function and so is `SyncOptions.onProgress`, and both look like data at a glance. The wire types are therefore deliberately *different types with different names*: `AppConfig`, not `Config`; `SyncRequest`, not `SyncOptions`.

**Nothing throws across the boundary.** Electron's IPC drops an error's prototype and its custom properties, so `instanceof` and `.code` are both worthless on the far side. Every handler returns a `Result`, tagged on the near side by `host/errors.ts` while the error is still itself.

## Long runs

`run/start` is single-flight, and the three cases are not symmetric:

- a second **sync** while a sync is running **joins** it and gets the same `runId` — two windows asking to sync meant one sync, and an error there answers a question nobody asked
- a **rebuild** is refused while anything is running, because `dropAll` is destructive and a joiner would receive a summary for a database it did not expect
- nothing may join a rebuild, for the same reason

This guards *this process only*. A second copy of the app running at the same time is fine and is designed for — WAL, the busy timeout, and the re-stat before each write. Do not add a lock file.

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

A command line could write a config, print two sentences of advice, and exit. A window cannot print-and-exit, and the stakes are specific: **the first real sync writes an id comment into every note that contains a card.** On an existing collection that is a diff across the whole tree. `init` can only warn about it; a window can make the number visible before it happens.

The sequence is welcome → confirm the folder → preview the settings → version control → preview the sync → run it, and `renderer/model/setup.ts` holds it as a pure state machine. Three things in there are load-bearing:

- **The real sync is unreachable without a preview.** `canSync` is false until a dry run has completed, and `picked` clears the preview — so choosing a different folder takes it back to false rather than letting the first folder's numbers authorise a sync of the second. That is the bug the model exists to prevent, and it is invisible in a screenshot.
- **`filesStamped` is the number the preview leads with**, not `cardsNew`. One file can hold fifty cards, and the question being asked is *how many of my notes does this rewrite*.
- **An empty folder is a warning, not a refusal.** Starting a collection from nothing is legitimate; pointing at a Downloads folder is the likeliest mistake. The count makes the second visible without blocking the first.

The folder count comes from `host/setup.ts`, which calls the *same* `enumerate` a sync uses — same dotted-directory skip, same `.md` filter, same refusal to follow directory symlinks. A second walk would drift, and a count that disagrees with what then happens is worse than no count. `boundaries.test.ts` forbids either interface from importing `files/` for this reason.

### An existing config is a choice, reached by asking

`initConfig` refuses to overwrite without `force`, and preserves `device` and `editor` even then — regenerating `device` would silently start a second log shard and scatter one machine's history across two names. The app surfaces that as a choice by calling `setup/propose` **before** writing anything, rather than by catching `InitRefused`. Two reasons: an exception is the wrong control flow for an ordinary answer, and the user needs to be *told* what is preserved — a GUI that quietly keeps a field looks like it ignored the question.

### A missing `notesPath` is a repair, not a first run

Routine on a desktop: the folder moved, or a drive is unmounted. Both states reach the app as "no usable collection", and giving them the same screen would greet a year-old user with a welcome page because something is unplugged. `App.tsx` tells them apart by inspecting the configured folder after reading the config, and the same component opens at the folder step with different words.

### Changing folder is the same walk, with a way out

**Change folder…** on the Vault screen enters the same sequence at the folder step (#43). It differs from a repair in three ways, all in `model/setup.ts`. It can be **cancelled**, because unlike a repair there is a working folder to go back to. It **refuses the folder already in use**. And leaving without finishing **writes the original folder back**: the preview writes the config before its dry run, because the run reads it. The folder to restore comes from `from`, which is captured on the way in, and never from the proposal. After one preview the proposal is read from a config that already names the new folder, so it would restore the wrong one. "Keep those" on the settings step goes through the same restore, for a repair as well.

The picker passes `createDirectory`, the only way the macOS panel offers New Folder, so a fresh collection can start without leaving the app. Choosing an empty folder during a change adds one line on the confirm step saying the old cards are still in the old folder (`leavesCollectionBehind`), because a collection that drops to zero reads as loss.

## Vaults

A vault is a notes folder together with its own database, and one is open at a time ([ADR 0027](../decisions/0027-vaults.md)). Everything main derives from the config — the `Core`, the `Store`, the `Runner`, `OpenedNotes` — lives in one `Active` object in `main/active.ts`, opened lazily on the first command that needs it and dropped all together. Every handler that rewrites the config goes through `Active.change`: `setup/write` (re-point), `vaults/add` and `vaults/switch`. Three rules live there, and each is tested against two real vaults in `active.test.ts`:

- **It refuses while a run is in flight**, before the config is written. `core` takes no `AbortSignal`, so the alternative is closing a `Store` under a running job. Refusing rather than waiting, because a click that hangs for the length of a rebuild says nothing.
- **It refuses to open anything while a switch is part-way through.** The config write is awaited, and a `run/start` landing in that window would otherwise start on the Store about to be closed.
- **It answers the vault being left's end-of-session question on the way out.** A review interrupted by a switch never reaches its own `note/changed` call, and after the switch that vault's `OpenedNotes` is gone. The answer rides on `VaultSwitched.left`, and the renderer turns it into a note naming the vault.

`vaults/rename` and `editors/set` do *not* go through it: neither changes which folder or database is open, so closing the Store would be all cost.

The switcher is a `<select>` at the end of the tab bar, and is blurred after every choice so the review screen's document-level keys are not typed into it. Its decisions — what the options are, what choosing one means, when **Remove…** is offered — are in `renderer/model/vaults.ts`. The repair screen shows it too, when there is another vault to go to: a vault on an unplugged drive must not trap the user in it.

**Adding a vault is the setup sequence with `from.reason = "add"`.** It differs from a change in what it writes and what it undoes, both in `model/setup.ts`: `mode(s)` is `add`, so the proposal mints a vault id — passed back to `vaults/add`, so the database path shown is the one written — and asks no keep-or-replace question. Undoing is `abandonAdd`: switch back to `from.vault`, then remove the added vault *and* its database, since the only thing in it is the preview. The id to remove is the one recorded at the write, not the proposal's, because picking another folder replaces the proposal. A second preview after a change of folder undoes the first add before adding again, so the vault in the list is always the one being previewed.

The folder step asks `setup/overlap` as soon as a folder is picked, so a folder inside another vault is refused there — `addVault` and `initConfig` refuse the same thing again at the write, and `host/vaults.ts` is the one check both use.

## Help

The user documentation, bundled and rendered in the app ([ADR 0020](../decisions/0020-ship-the-docs-inside-the-app.md)). A Vite plugin copies `docs/guides/` and `docs/reference/` into the renderer bundle at build time, and `Help.tsx` renders them with `marked`.

**One source, two surfaces.** The files rendered are the repository's own, verbatim — a Help window authored separately would drift within two releases, which is what [ADR 0018](../decisions/0018-user-docs-live-in-guides-and-reference.md) was written to prevent. `design/` and `decisions/` are deliberately not bundled: they are contributor material, and shipping them buries the four documents a user needs.

Links are intercepted at the container rather than rewritten in the HTML. A link to another bundled document navigates inside the window; anything else resolves against the repository's blob URL and opens in a browser. Left alone, a relative link navigates the `app://` page away from the renderer and strands the user in a blank window with no way back.

`dangerouslySetInnerHTML` is safe here **because the input is ours**. The moment a note's text is rendered this way that stops being true.

## What the screens take from `host`

A decision lives in `host`, not in the component that wanted it first. With two interfaces the failure mode was each staying self-consistent while disagreeing with the other; with one it is a decision arriving inside a component with a layout attached, where it stops looking like a decision ([ADR 0025](../decisions/0025-the-app-is-the-only-interface.md)):

| In `host` | Why it cannot be per-interface |
|---|---|
| `RATING_KEYS`, `interpretKey` | what `3` does, and whether `escape` quits |
| `resolveEditor`, `editorCommand`, `launchCommand`, `detectEditors` | which program `o` opens, how it is told a line, where it is installed, and which editors the Vault screen offers |
| `OpenedNotes` | the mtime-at-open record behind "this note changed" |
| `summaryFields` | which counts a sync reports, and in what order |
| `deferralReason` | why a freshly-edited file was left alone |
| `PHASE_LABEL` | what `scan` / `prune` / `ingest` are called |
| `queue.ts` | which card is next, and when a rated card comes back |
| `countText`, `COUNT_CAP` | how far a backlog is counted, and how a capped count reads |

What stays here is *drawing*, and one thing that is not drawing: the **spawn**. `electron/main/open.ts` detaches and returns at once, because a GUI has no TTY to hand over and must not block for as long as a note stays open. `host` spawns nothing, which is what keeps it usable from an interface that has not been written yet. See [module-map.md](module-map.md).

`boundaries.test.ts` enforces every row of that table by scanning source text.

## Opening a note: a Mac app does not get your shell's `PATH`

A `.app` opened from Finder or the Dock starts with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. So `"editor": "code"` works under `npm start`, which inherits the terminal's `PATH`, and fails in a packaged build. The failure is an `ENOENT`, reported rather than hung on, but `o` still does nothing useful, and **only a Finder launch shows it**. `GEODE_SELFTEST` runs from a terminal and cannot catch it.

The config therefore keeps a **plain name**, and `launchCommand` in `host/editor.ts` resolves it each time `o` is pressed: `PATH` first, then the launcher inside the editor's app bundle (`MAC_BUNDLES`, under `/Applications` and `~/Applications`). The resolved file is what gets spawned. Storing the resolved path instead would not work: `editorCommand` splits the value on whitespace, deliberately and with no shell, so `/Applications/Visual Studio Code.app/…` would split at its spaces. Resolving at open time also means an editor moved or reinstalled after it was chosen is still found.

The line flag is chosen from the name *before* it is resolved. That is why Zed, whose launcher is a file called `cli`, still lands on the line.

A named editor that is found nowhere is an `editor` error, **not** a fallback to the OS opener. A fallback would open the note at the top, and nothing would tell the user why the line jump had stopped working.

The Vault screen lists only GUI editors that `editorCommand` can put on a line, and no terminal editors: the spawn is detached with no TTY, so `vim` would start in a window nobody can type into. **Other…** takes any command for the rest.

## The two traps

**The renderer is served over `app://`, not `file://`.** Chromium blocks ES modules on `file://` under its CORS rules and Vite emits a module script, so `loadFile` produces a window that loads and silently does nothing — no error anywhere. A custom scheme has a real origin, so modules load, relative assets resolve, and the CSP in `index.html` means something.

**The preload is CommonJS.** `sandbox: true` rejects an ESM preload, and the sandbox is worth more than the consistency. `.cts` so `tsc` emits `.cjs` regardless of the package type.

## Seeing it

```sh
npm run build:desktop
npm --prefix desktop start                                     # just run it
GEODE_SELFTEST=1 npx electron dist/electron/main/index.js      # headless, exits non-zero on failure
```

### Reviewing a real session

Worth doing deliberately, and easy to skip: the review screen is covered by unit tests, a self-test driving real keypresses, and screenshots read back — none of which answer **whether it is pleasant to review in**, which is not the kind of thing a test answers.

A throwaway collection, scoped to its own config so it cannot disturb the one you actually use:

```sh
DEMO=~/geode-demo
mkdir -p $DEMO/{notes,config,data} && cp -r demo/* $DEMO/notes/
(cd $DEMO/notes && git init -q . && git add -A && git commit -qm before)

export XDG_CONFIG_HOME=$DEMO/config XDG_DATA_HOME=$DEMO/data
npm run build:desktop && npm --prefix desktop start   # then point it at $DEMO/notes
```

The `XDG_*` variables are the load-bearing part. Without them this writes over the config pointing at your real notes, and a replace preserves `device` — so you would not even get a refusal, you would get your live collection repointed at the demo.

Two seconds of care with mtimes: a freshly copied file is inside the deferral window, so the first sync stamps nothing and reports `0 new`. Either sync twice or backdate with `find $DEMO/notes -name '*.md' -exec touch -A -001000 {} \;`.

`git -C $DEMO/notes diff` afterwards shows exactly what a first sync does to someone's notes, which is the other thing worth seeing once.

The self-test drives every channel against a real database **and** clicks real buttons and presses real keys, because a button wired to the wrong handler passes every API-level check. `console.log("SHOT name")` from the renderer writes `name.png` of the window — the only way to find out whether anything rendered, whether text is legible, or whether a layout collapsed. Screenshots are diagnostic, never fixtures: comparing them byte-for-byte across machines fails on font rendering alone.

Three substitutions keep the harness runnable rather than invasive:

- `o` spawns `touch` instead of the real editor, so a run does not open TextEdit but the end-of-session "this note changed" path still fires
- the rebuild confirmation is asserted without the rebuild being run, because on a real collection that is minutes
- `GEODE_SELFTEST_FOLDER` answers the folder picker, because a native modal has no DOM to click — everything downstream of the pick is driven for real. `GEODE_SELFTEST_SECOND_FOLDER` answers it when the harness adds a second vault

With no config present and that variable set, the harness drives the whole first-run sequence and then continues into the review checks against the vault it just set up. **It performs a real first sync**, so point it at a copy. With the second variable set as well, it adds that folder as a second vault, switches to it and back through the tab bar, and checks that the Vault screen's counts follow — another real first sync, so another copy, and one that does not hold the same notes as the first, or the counts cannot tell the vaults apart.
