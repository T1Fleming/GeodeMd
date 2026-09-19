# 0006 — Module boundaries are enforced by test, not convention

- **Status:** Accepted
- **Date:** 2026-09-19 (backfilled)
- **Source:** plan.md §6

## Context

Phase 1 is a CLI. A later phase is an Electron app. The difference between that being an interface swap and a rewrite is entirely whether the core stayed free of terminal assumptions — and boundaries that exist only as prose in a design document erode in the ordinary course of getting something working.

## Decision

Six modules, each owning at most one external resource:

```
parser/     text -> cards. PURE: no fs, no db, no clock
files/      the ONLY module that touches the filesystem, log included
store/      the ONLY module that touches SQLite
scheduler/  ts-fsrs behind an interface
core/       orchestration; the public API
cli/        argv and terminal I/O; thin
```

Five hard rules: `core` never imports `cli`; `core` returns data and never prints, exits or prompts; no module reads ambient config, with `now: () => Date` and `newId: () => string` passed in rather than read; `parser` never opens a file; long operations take an `onProgress` callback rather than printing.

**These are asserted by `src/boundaries.test.ts`**, which scans source text for violations — imports of `cli` from below, `console.*` or `process.env` in `core`, `better-sqlite3` or raw SQL outside `store/`, a clock in `parser/`.

## Consequences

- The rules are checked by `npm test`, not by the compiler. `npm run build` is `tsc` and will happily compile a violation.
- The checker strips comments before matching, because these modules *document* the rules they obey and a naive scan would fail on the prose rather than on a violation.
- Injecting the clock and the ID generator is not purity for its own sake: without them the tests in plan.md §10 cannot be written at all. Asserting that stamping is idempotent needs predictable IDs, and asserting that a card comes due needs to fast-forward past its interval.
- The review log lives in `files/` rather than `store/` despite holding review history, because filing it under `store/` would put `fsync` and `O_APPEND` in the module whose only job is SQLite.
- If the five rules hold, the Electron app is `core` plus a renderer. If they don't, it is a rewrite. That is the whole reason they are tested.
