# 0016 — Configuration lives in `host/`, below both interfaces

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

[ADR 0013](0013-cli-and-electron-are-peers.md) made the CLI and the Electron app permanent peers over one `core`, and named exactly one consequence it could not resolve:

> Config is read in exactly one place by design, and that place is `cli/config.ts`. A second interface needs the same `notesPath`, `device`, `dbPath` and `editor`, and cannot inherit them: `core` is forbidden from reading ambient config, and a sibling interface importing `cli/` inverts what `cli/` is for. Either config parsing moves below both interfaces, or the two duplicate it and drift.

This is that decision.

## Decision

A new module, **`src/host/`** — the code that knows about *this machine*: XDG paths, `process.env`, `os.hostname()`, and how you obtain a `Core` here.

The name states the rule that separates it from `core`:

> **`host` may read ambient machine state. `core` may not.**

`core` knows only about its arguments. `host` sits above it, below both interfaces, and may import neither.

`src/cli/config.ts` moved wholesale — it had zero terminal dependencies, and `env` and `hostname` were already injectable parameters rather than direct reads, which is what made it portable in the first place.

`openCore` split in two:

- **`readAppConfig()` returns `null`** when there is no config. A first run is an ordinary state, not an error — a GUI must distinguish "no config yet, show onboarding" from "something went wrong", and code that decides that by catching an exception eventually shows onboarding after a disk error.
- **`openCore(config)`** does the `Store` and `Core` wiring, including the named-fields-rather-than-spread that keeps `editor` out of `core`'s `Config`.

The CLI keeps a two-line or-throw wrapper, because every command that calls it wants to exit non-zero.

## Consequences

- **The boundary is tested, not trusted** — `host` may not import `cli` or `electron`; `core` and everything below may not import `host` (rule 3 in reverse: `host` reads ambient state, so importing it would be a back door); `host` may not write to the terminal, because it is shared with a GUI. Each rule was verified by violating it deliberately and watching it fail.
- **The scanner in `boundaries.test.ts` had to be fixed first.** It did one `readdir` and accepted `.ts` only, so a module keeping files in subdirectories would have been scanned *not at all* — every rule passing while reading nothing. Proven rather than assumed: with identical rules and an identical violating file in `host/sub/`, the one-level scanner reported 13/13 green and the recursive one failed.
- What remains in `cli/` is genuinely terminal: argv parsing, raw mode, ANSI, and the `spawn` with `stdio: "inherit"`. A second interface needs none of it.
- Still to move when a second interface actually needs them: `isBusy`, `interpretKey`, `RATING_KEYS`, and the presentation *policy* inside `formatSummary`. Consolidation, not architecture — none of it blocks anything.
