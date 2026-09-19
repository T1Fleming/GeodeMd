# 0008 — A sync costs what changed, and a no-change sync writes nothing

- **Status:** Accepted
- **Date:** 2026-09-19 (backfilled)
- **Source:** plan.md §8

## Context

`sync` is the command the user runs constantly, and the design targets a million cards across a million files. At that size the difference between reading everything and reading what changed is the difference between a tool you run without thinking and one you avoid.

## Decision

Cache `(path, mtime_ms, size)` in a `files` table and classify each candidate against it: both match and `--full` was not passed → **unchanged, skip without opening**; row exists and they differ → **changed**; no row → **new**.

The organizing rule has two halves, and the second is the one that is easy to miss:

> A sync costs what *changed*, not what exists — and a sync that finds nothing changed must also **write** nothing.

A million rows of bookkeeping costs more than the walk that produced them. So the shape of a no-op sync is stated plainly and defended: one `stat` per file, one indexed read per file, one `COUNT(*)`, one `stat` per log shard. **No writes, anywhere.**

Measured on a 50,000-file tree, warm, extrapolated:

| Files | `stat` only | `stat` + read + parse |
|---|---|---|
| 100k | 0.17 s | 3.8 s |
| 1M | 1.7 s | 38 s |

That 22× is what the mtime cache buys.

## Consequences

- `(mtime, size)` is a heuristic, and where it is wrong it is **silently** wrong: a tool that rewrites a file while preserving its mtime leaves stale cards in the database forever. That is what `--full` is for, and it is why `--full` is a documented flag rather than a debugging aid.
- Size is compared as well as mtime because mtime granularity is one second on some filesystems.
- The no-write property is asserted by the scale harness rather than assumed, because it is exactly the kind of thing that regresses the moment someone adds innocuous bookkeeping. The harness asserts **ratios and counts, not wall-clock ceilings** — those pass on a laptop, fail in CI, and then get raised until they mean nothing.
- Writes are batched into transactions of a few thousand upserts with prepared statements. An autocommit-per-statement sync at a million cards is the difference between seconds and hours.
- Two concurrent syncs are safe by construction and **must not acquire a lock**: the re-stat before each write means the second process skips whatever the first already wrote, and WAL plus a busy timeout serializes SQLite.
