# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GeodeMD (`geode`) is a spaced repetition tool where everything durable is plain text: cards live as one-line `::` entries inside the user's own Markdown notes, review history is an append-only JSONL log next to those notes, and the SQLite database is a fully rebuildable cache stored elsewhere. It has **two interfaces**: the `geode` CLI, and an Electron app under construction. They are peers — neither replaces the other ([ADR 0013](docs/decisions/0013-cli-and-electron-are-peers.md)).

`README.md` covers what it is and quickstart usage; `docs/guides/` covers the tasks with real stakes. `docs/design/` describes how each subsystem works now — read the relevant one before changing sync, the parser, or the store schema.

## Documentation map

`docs/` is split by how stable each kind of writing is — check the right one before trusting or updating a claim:

```
docs/decisions/   ADRs — immutable once written, numbered. Don't edit a past decision; add a new ADR that supersedes it.
docs/design/      how the system works now — living, kept in sync with the code.
docs/guides/      how to do a task — living.
docs/reference/   what to look up: config keys, commands, exit codes.
```

**Audience is the split, on top of stability** ([ADR 0018](docs/decisions/0018-user-docs-live-in-guides-and-reference.md)): `guides/` and `reference/` are written for people *using* GeodeMD; `design/` and `decisions/` for people *working on* it. Schemas are contributor material and live in `design/data-model.md`, not in `reference/`.

`README.md` is the front door and stays one: install, quickstart, the command table. Anything longer than a screen becomes a guide and gets linked.

`docs/design/app.md` is the one to read before changing anything under `src/electron/` — the IPC contract's two rules, the single-flight and reconciliation rules for long runs, and why there is no cancel button.

Start at [`docs/design/README.md`](docs/design/README.md): it indexes the subsystem docs and maps the brief's section numbers onto them. `docs/design/phase-1-brief.md` is the original pre-code spec — **historical, do not update it**; when it disagrees with a design doc, the design doc is right.

## Commands

```sh
npm run build       # tsc -> dist/
npm test            # vitest run (full suite)
npm run test:watch  # vitest watch mode
npm run typecheck   # tsc --noEmit
```

Run a single test file or a single test by name with vitest directly, e.g.:

```sh
npx vitest run src/core/review.test.ts
npx vitest run -t "some test name"
```

The full suite takes about a second, scale harness included — there is no speed reason to run a subset, so prefer `npm test`.

The suite runs serially (`pool: forks`, `singleFork: true`) — see `vitest.config.ts` — because sync/scale tests touch real temp directories and mtimes, and wall-clock assertions in the scale harness would otherwise fight for I/O.

`npm run build` is `tsc` and checks types only. The architecture rules below are enforced by a *test*, not the compiler, so a boundary violation shows up in `npm test` and nowhere else.

After editing `src/`, `npm run build` is required for a `npm link`-installed `geode` binary to reflect the change (it runs from `dist/`, not `src/`).

## Working on features

Feature work happens in a git worktree branched from `main`, not on `main` itself:

```sh
git worktree add ../GeodeMd-<feature> -b <feature> main
cd ../GeodeMd-<feature>
npm install
```

`npm install` in the new worktree is not optional: `node_modules/` is gitignored and therefore not carried over, and `better-sqlite3` is a native module that must be built against the Node version in `.nvmrc` — the same version you run `geode` with.

Branch from `main` explicitly (the trailing `main` above) rather than from whatever the current worktree has checked out. Remove a worktree with `git worktree remove ../GeodeMd-<feature>` once its branch is merged.

## Architecture

The module boundaries below are load-bearing, not just convention — `src/boundaries.test.ts` enforces them by scanning source text, and crossing one of these lines fails that test:

```
src/parser/     pure: text -> cards. No filesystem, no database, no clock.
src/files/      the only module that touches the filesystem, log included
src/store/      the only module that touches SQLite
src/scheduler/  FSRS, with its parameters pinned in source (not inherited from ts-fsrs defaults)
src/core/       the Core class — sync, ingestLogs, getDueCards, countDue, reviewCard, stats, rebuild
src/host/       this machine: XDG paths, env, hostname, config, error kinds,
                shared vocabulary: ratings, editor resolution, summary fields, phases
src/cli/        argv, review loop, ANSI              one of two interfaces
src/electron/   window, IPC contract, renderer       the other
src/index.ts    the public API: re-exports Core, Store, FsrsScheduler, and the parser functions
```

**`cli` and `electron` are peers**: neither imports the other, and whatever they share lives in `host` ([ADR 0016](docs/decisions/0016-config-lives-in-host.md)). The line between `host` and `core` is ambient state — `host` may read `process.env`, `os.hostname()` and the config file; `core` may read none of it.

Anything both interfaces would want belongs in `host` or `core`, **not** in whichever one asked for it first. That is not a style preference: if the app grew its own key handler, each interface would stay self-consistent while disagreeing about what `3` does, and nothing would fail ([ADR 0018 on docs](docs/decisions/0018-user-docs-live-in-guides-and-reference.md) is the same idea applied to writing).

Hard rules enforced by `boundaries.test.ts` (know these before moving code between modules):

- `core` never imports an interface, and nothing below the interfaces imports one — dependencies point one way. `cli` and `electron` never import each other.
- `core` never writes to the terminal (`console.*`), never calls `process.exit`/`process.stdout`/`process.stderr`, and never reads `process.env` — it takes everything as arguments, which is what lets one core serve both interfaces.
- `host` may read ambient machine state — that is its whole job — but never writes to the terminal, because a GUI shares it.
- `host` owns the review vocabulary (`RATING_KEYS`, `interpretKey`). Neither interface may define its own rating table.
- `host` owns what a sync summary *says* — `summaryFields` (which counts, in what order), `deferralReason`, and `PHASE_LABEL`. Neither interface may restate the list; the test greps for `duplicate ids re-minted` and `reading review history` outside `host`. What is left to each is layout: the CLI joins with commas and folds `detail` fields into parentheses, the app lays them out as a grid.
- `host` also owns *which program opens a note* (`resolveEditor`, `editorCommand`, the `+142`/`--goto`/`:142` tables). Neither interface may define its own editor table — the test greps for `--goto` outside `host`. The `spawn` is the opposite case and stays split: `cli/` uses `stdio: "inherit"` and awaits the child because a terminal editor holds the TTY, `electron/` uses `detached: true` and returns at once because a GUI has no TTY and must not block for as long as a note stays open. `host` spawns nothing, which is what keeps it usable from both.
- `parser` opens no file, touches no database, and calls no clock (`new Date()`/`Date.now()`) — it is pure text-in, cards-out.
- Only `store/` imports `better-sqlite3` or contains raw SQL.
- The append-only review log lives under `files/` (with `fsyncSync`), not `store/` — `store/` never calls fsync or uses `O_APPEND`, keeping SQLite-specific code separate from durability-critical log I/O.
- `scheduler` pins its FSRS parameters (`enable_fuzz: false`, `request_retention`, `maximum_interval`, the `w` weight vector) literally in source, rather than trusting `ts-fsrs` defaults — so a dependency bump can't silently change what a `rebuild` produces from an unchanged log.

Other properties the test suite asserts rather than assumes (regressions here are silent otherwise):

- A rebuild from notes + logs must reproduce the database exactly — there is no column that doesn't derive from one of those two sources.
- A sync costs what *changed*, not what exists: an incremental sync with nothing changed reads no file and writes no database row. The mtime cache is what makes this true.

## Conventions

**Time is injected, never read.** Every `Core` method takes `now: Date` as an explicit parameter — `sync(now, opts)`, `getDueCards(now, limit)`, `reviewCard(id, rating, now)`, and the rest. This is the practical form of "no ambient state": `core` and `parser` never call `Date.now()` themselves, which is what makes scheduling deterministic and rebuild-from-log reproducible. A new method on `Core` that needs the time takes it as an argument.

**Purity is split from I/O even inside an interface.** `render.ts` builds strings and `index.ts` decides when to print them; `host/editor.ts` keeps `resolveEditor`/`editorCommand` pure and each interface confines its own `spawn` to one place (`cli/editor.ts` inherits the TTY and waits, `electron/main/open.ts` detaches and returns). In `electron`, `main/runs.ts` holds single-flight and the progress throttle with no Electron imports at all, so it tests under plain vitest. The payoff is the same both times: the decisions are testable without a pseudo-terminal or a running app. Follow the split when adding to either.

**Source comments cite the original brief by section.** Module headers say things like "section 6 rule 2" or "section 8 step 4", referring to `docs/design/phase-1-brief.md` — retired, historical, still the target of 83 such citations. `docs/design/README.md` maps each section onto the document that now owns it. When code looks odd, that citation is where the rationale lives. **New code should cite the design docs or an ADR, not a brief section.**

**Exit codes are contract**, derived from `host/errors.ts`'s `ErrorKind` so the CLI exercises the same classifier the app does: `0` success — *including* a run that skipped an unreadable file, since a skip is a reported outcome and making it non-zero would break every script the first time a note has bad permissions; `1` configuration or usage error; `2` unexpected internal error.

## The parser

Cards are `<question> :: <answer>`, with `::` requiring whitespace on both sides (`foo::bar` is not a card). A leading list marker or task box is stripped from the question, so `- [ ] foo :: bar` yields the question `foo`. Trailing HTML comments are stripped from the answer. The stamp is an HTML comment at end of line holding `sr-` plus exactly 12 alphanumerics; re-minting replaces an existing stamp rather than appending a second one.

Cards are *not* read from fenced or indented code blocks, inline code spans, tables, YAML frontmatter, blockquotes, or headings. The reason that skip list is longer than a card parser seems to need: a false positive does not merely produce a junk card, **it writes a stamp into the user's note**. Weigh any change to the recognition rules against that.

Lines keep their own terminators end to end (`splitLines` splits *after* the newline), which is how a CRLF file stays CRLF and a file with no trailing newline keeps that too.

## Seeing the Electron app

`npm run build:desktop`, then from `desktop/`:

```sh
npm start                                   # just run it
GEODE_SELFTEST=1 npx electron dist/electron/main/index.js   # headless, exits non-zero on failure
GEODE_SHOT_DIR=/tmp/shots GEODE_SELFTEST=1 npx electron dist/electron/main/index.js
```

The self-test drives every IPC channel against a real database **and** clicks real buttons, because a button wired to the wrong handler passes every API-level check. `console.log("SHOT name")` from the renderer writes `name.png` of the window — which is the only way to find out whether anything rendered, whether text is legible, or whether a layout collapsed. Screenshots are diagnostic, never fixtures: comparing them byte-for-byte across machines fails on font rendering alone.

## Things that cost an hour

Not discoverable from the code, and each one presented as something other than what it was.

**A `<script type="module">` on a `file://` page is blocked by CORS and silently never executes.** The renderer loads and does nothing — no error, no clue. Electron pages here are loaded with `loadFile`, so use a plain `<script>` unless you are genuinely importing.

**The `write()` helper in `src/core/sync.test.ts` backdates mtime on purpose**, to keep fixtures out of the 2-second deferral window. A test that needs a file to *be* deferred must write it directly with `fs.writeFile`, as the existing deferral tests do. Using the helper gives a test that asserts a deferral which cannot happen.

**Two builds, two dependency sets.** `npm run build` is the CLI and needs nothing from `desktop/`. `npm run build:desktop` emits to `desktop/dist/` — it must, because Node resolves `node_modules` by walking *up*, and output under `dist/` finds the root Node-ABI `better-sqlite3` rather than the Electron-ABI one. The root tsconfig therefore excludes exactly the files that `import "electron"`; everything else under `src/electron/` stays type-checked and testable. See `desktop/README.md`.

**Anything awaiting an external process needs a timeout.** Three separate failures in this app presented as a silent hang rather than an error — a worker that could not load, a completion event subscribed to too late, and a page script that never ran. Each cost far more to diagnose than the bug deserved. `measure.bench.ts` and the renderer self-test both have hard timeouts for this reason.
