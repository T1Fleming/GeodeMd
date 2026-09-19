# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GeodeMD (`geode`) is a spaced repetition CLI where everything durable is plain text: cards live as one-line `::` entries inside the user's own Markdown notes, review history is an append-only JSONL log next to those notes, and the SQLite database is a fully rebuildable cache stored elsewhere. `README.md` covers what it is, why it's built this way, and quickstart usage (install, `geode init`, `geode sync --dry-run`, writing cards, `geode review`) — read it for user-facing behavior. `plan.md` is the design brief and explains *why* the data model, sync algorithm, and identity rules are shaped the way they are — read it before changing sync, the parser, or the store schema.

## Documentation map

`docs/` is split by how stable each kind of writing is — check the right one before trusting or updating a claim:

```
docs/decisions/   ADRs — immutable once written, numbered. Don't edit a past decision; add a new ADR that supersedes it.
docs/design/      how the system works now — living, kept in sync with the code.
docs/guides/      how to do a specific task — living.
docs/reference/   config, API, schemas — often generated; check for a generator before hand-editing.
```

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
src/cli/        argv, config, review loop, and terminal presentation
src/index.ts    the public API: re-exports Core, Store, FsrsScheduler, and the parser functions
```

`src/index.ts` is the surface a future Electron renderer imports — `core` is reached through it, and nothing it exports reaches into `cli`.

Hard rules enforced by `boundaries.test.ts` (know these before moving code between modules):

- `core` never imports `cli`, and nothing below `cli` imports it either — dependencies point one way.
- `core` never writes to the terminal (`console.*`), never calls `process.exit`/`process.stdout`/`process.stderr`, and never reads `process.env` — it takes everything as arguments so it stays reusable behind a future non-CLI interface (an Electron renderer, per `README.md`'s Status section).
- `parser` opens no file, touches no database, and calls no clock (`new Date()`/`Date.now()`) — it is pure text-in, cards-out.
- Only `store/` imports `better-sqlite3` or contains raw SQL.
- The append-only review log lives under `files/` (with `fsyncSync`), not `store/` — `store/` never calls fsync or uses `O_APPEND`, keeping SQLite-specific code separate from durability-critical log I/O.
- `scheduler` pins its FSRS parameters (`enable_fuzz: false`, `request_retention`, `maximum_interval`, the `w` weight vector) literally in source, rather than trusting `ts-fsrs` defaults — so a dependency bump can't silently change what a `rebuild` produces from an unchanged log.

Other properties the test suite asserts rather than assumes (regressions here are silent otherwise):

- A rebuild from notes + logs must reproduce the database exactly — there is no column that doesn't derive from one of those two sources.
- A sync costs what *changed*, not what exists: an incremental sync with nothing changed reads no file and writes no database row. The mtime cache is what makes this true.

## Conventions

**Time is injected, never read.** Every `Core` method takes `now: Date` as an explicit parameter — `sync(now, opts)`, `getDueCards(now, limit)`, `reviewCard(id, rating, now)`, and the rest. This is the practical form of "no ambient state": `core` and `parser` never call `Date.now()` themselves, which is what makes scheduling deterministic and rebuild-from-log reproducible. A new method on `Core` that needs the time takes it as an argument.

**Purity is split from I/O even inside `cli`.** `render.ts` builds strings and `index.ts` decides when to print them; `editor.ts` keeps `resolveEditor`/`editorCommand` pure and confines the `spawn` to one place. The payoff is that output and editor-command construction are tested without a pseudo-terminal. Follow the same split when adding to `cli`.

**Source comments cite `plan.md` by section.** Module headers say things like "section 6 rule 2" or "section 8 step 4". When code looks odd, that citation is where the rationale lives — and new code that encodes a spec decision should cite it the same way.

**Exit codes are contract** (`cli/index.ts`): `0` success — *including* a run that skipped an unreadable file, since a skip is a reported outcome and making it non-zero would break every script the first time a note has bad permissions; `1` configuration or usage error; `2` unexpected internal error.

## The parser

Cards are `<question> :: <answer>`, with `::` requiring whitespace on both sides (`foo::bar` is not a card). A leading list marker or task box is stripped from the question, so `- [ ] foo :: bar` yields the question `foo`. Trailing HTML comments are stripped from the answer. The stamp is an HTML comment at end of line holding `sr-` plus exactly 12 alphanumerics; re-minting replaces an existing stamp rather than appending a second one.

Cards are *not* read from fenced or indented code blocks, inline code spans, tables, YAML frontmatter, blockquotes, or headings. The reason that skip list is longer than a card parser seems to need: a false positive does not merely produce a junk card, **it writes a stamp into the user's note**. Weigh any change to the recognition rules against that.

Lines keep their own terminators end to end (`splitLines` splits *after* the newline), which is how a CRLF file stays CRLF and a file with no trailing newline keeps that too.
