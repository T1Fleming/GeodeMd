# 0013 — The CLI and the Electron app are peer interfaces, permanently

- **Status:** Accepted
- **Date:** 2026-09-19

## Context

The phase 1 brief framed this as a sequence: *"Phase 1 is a CLI. A later phase is an Electron app. The structure below exists so that later phase is an interface swap, not a rewrite."*

Read literally, that makes the CLI scaffolding — something the GUI eventually replaces, and the module boundaries a migration aid that stops mattering once the migration lands.

That is not the intent.

## Decision

**Both, indefinitely. Neither replaces the other.** `core` serves two peer interfaces, and the CLI is a shipping product rather than a stage the project passes through.

The CLI earns its permanence on three things a GUI does not do well:

- **It composes.** Exit codes, `--dry-run`, and the summary object exist so `sync` can sit in a script or a cron entry. A GUI cannot be a step in a pipeline.
- **The terminal review loop is the fast path** for someone already in a terminal, which is where this tool's notes are usually being edited.
- **`sync` is a batch operation**, and batch operations belong where batch operations live.

## Consequences

**The five boundary rules become permanent structure, not a migration aid.** [ADR 0006](0006-module-boundaries-enforced-by-test.md) is reinforced rather than superseded: its decision — enforce the boundaries by test — was right and is unchanged. Only its motivation widens, from "so the swap is cheap once" to "so two interfaces can be served forever." 0006 is left exactly as written, because it was true when it was written.

**Anything both interfaces need belongs in `core`, not in whichever interface needed it first.** There is already one live example: `editor.ts` keeps `resolveEditor` and `editorCommand` as pure functions, and a GUI wanting to open a card's note would want exactly those — but they sit in `cli/`.

**Config is the open problem.** It is read in exactly one place by design, and that place is `cli/config.ts`. A second interface needs the same `notesPath`, `device`, `dbPath` and `editor`, and cannot inherit them: `core` is forbidden from reading ambient config, and a sibling interface importing `cli/` inverts what `cli/` is for. Either config parsing moves below both interfaces, or the two duplicate it and drift. **This is not decided here** — it is named so that whoever starts the Electron work meets it deliberately rather than by surprise.

**Concurrency stops being the exceptional case.** A GUI left open while `geode sync` runs in a terminal is an ordinary Tuesday, not a corner case. The design already survives it — WAL with a busy timeout, the `(mtime, size)` re-stat immediately before each write, log-before-database ordering, and no lock file anywhere — but those properties were argued against a rarer scenario and are now load-bearing every day. **Do not add a lock file to fix a problem this design does not have.**

**Two processes, one device name, one log shard.** Both interfaces run on the same machine, so both write to the same monthly file. `O_APPEND` with one-line writes far under `PIPE_BUF` is what makes the interleaving safe, and `(card_id, rated_at)` makes a duplicate a no-op. Already covered by [ADR 0005](0005-append-only-review-log.md); now routine rather than theoretical.

## Alternatives considered

**Electron replaces the CLI once it ships.** Rejected — it discards scripting and the terminal fast path, which are not consolation prizes for lacking a GUI but the reason a fair number of people would pick this tool at all.

**Two codebases sharing nothing.** Rejected — it duplicates the scheduler and the sync algorithm, which are precisely the two places where a silent divergence would produce wrong schedules from an uncorrupted log.
