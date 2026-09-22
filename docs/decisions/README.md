# Architecture decision records

One decision per file, numbered, **immutable once merged**. A decision that turns out to be wrong is not edited — a new ADR supersedes it, and the old one gains a `Superseded by` line. The record of having believed something is the point.

ADRs 0001–0012 were **backfilled on 2026-09-19**, after `docs/` existed but long after the decisions were taken. Their provenance is the [phase-1 brief](../design/phase-1-brief.md), which argued each one at the time; the `Source` line on each ADR names the section it came from. Their dates are the backfill date, not the decision date, which is not recoverable at this remove.

New decisions from here get an ADR when they are made, not in a later sweep — 0013 onward are written at the time, and their dates are real.

| # | Decision | Status |
|---|---|---|
| [0001](0001-plain-text-is-the-durable-store.md) | Plain text is the durable store; SQLite is a derivable cache | Accepted |
| [0002](0002-one-line-card-syntax.md) | One-line `::` card syntax with a strict skip list | Accepted |
| [0003](0003-stamp-identity-into-the-note.md) | Cards are keyed on an opaque ID stamped into the note | Accepted |
| [0004](0004-twelve-character-ids.md) | Card IDs are twelve characters, not eight | Accepted |
| [0005](0005-append-only-review-log.md) | Review history is an append-only JSONL log, sharded per device per month | Accepted |
| [0006](0006-module-boundaries-enforced-by-test.md) | Module boundaries are enforced by test, not convention | Accepted |
| [0007](0007-pin-fsrs-parameters-in-source.md) | FSRS parameters are pinned in source, not inherited | Accepted |
| [0008](0008-incremental-sync-costs-what-changed.md) | A sync costs what changed, and a no-change sync writes nothing | Accepted |
| [0009](0009-prune-by-bitmap-and-count-check.md) | Deletions are found by a count check and a bitmap | Accepted |
| [0010](0010-absence-is-not-deletion.md) | Absence is not deletion: no tombstones | Accepted |
| [0011](0011-enumeration-is-a-seam.md) | Enumeration is a seam: walk now, snapshot later | Accepted |
| [0012](0012-open-the-note-from-review.md) | Review can open the note, and detects edits by an end-of-session sweep | Accepted |
| [0013](0013-cli-and-electron-are-peers.md) | The CLI and the Electron app are peer interfaces, permanently | Accepted |
| [0014](0014-cross-device-sync-transport.md) | Cross-device sync transport | Superseded by [0021](0021-no-built-in-sync-transport.md) |
| [0015](0015-accept-clock-skew.md) | Accept clock skew; do not build vector clocks | Accepted |
| [0016](0016-config-lives-in-host.md) | Configuration lives in `host/`, below both interfaces | Accepted |
| [0017](0017-core-runs-in-the-main-process.md) | `core` runs in the Electron main process, and the seam stays | Accepted |
| [0018](0018-user-docs-live-in-guides-and-reference.md) | User documentation lives in `guides/` and `reference/`, as plain Markdown | Accepted |
| [0019](0019-report-sync-conflict-copies.md) | Report a syncer's conflict copy rather than syncing it | Accepted |
| [0020](0020-ship-the-docs-inside-the-app.md) | Ship the user documentation inside the app | Accepted |
| [0021](0021-no-built-in-sync-transport.md) | No built-in sync transport; carry the notes directory | Accepted |
| [0022](0022-defer-a-card-without-rating-it.md) | Defer a card without rating it | Accepted |

## Writing one

Keep the rejected alternative in the record. Most of these decisions are only legible next to the thing they are not, and the reasoning is what stops a later reader from "simplifying" a design back into a bug.
