# 0009 — Deletions are found by a count check and a bitmap

- **Status:** Accepted
- **Date:** 2026-09-19 (backfilled)
- **Source:** plan.md §8 step 6

## Context

A deleted note leaves no signal except absence, so something has to notice that a `files` row no longer has a file behind it. Doing that naively conflicts directly with [0008](0008-incremental-sync-costs-what-changed.md): the obvious implementations all write on every sync, including syncs where nothing changed.

## Decision

During classification, count `hits` — candidates that had a `files` row — and set that row's bit in an in-memory bitmap indexed by rowid. At a million files the bitmap is 125 KB.

Then compare `hits` against `known`, the row count of `files` **taken before the walk began** so that files inserted during this pass cannot skew it:

- **`hits == known`** — every known file is still there. Nothing was deleted or renamed. **Stop.** A sync that found no changes has now written nothing at all.
- **`hits < known`** — `known - hits` files vanished. Scan `files` by rowid once; every row whose bit is unset is gone. Delete their `cards` rows, then their `files` rows. One sequential scan, no second enumeration, no temporary table.

## Alternatives considered

**A generation counter stamped on every row each pass.** Rejected: a million indexed writes and tens of megabytes of WAL traffic *for a sync that found nothing* — more expensive than the walk it was bookkeeping for.

**A count check plus a second walk staging every path into a temporary table.** Rejected: it removed the cost from the common case and put it straight back on any sync where a single file was renamed.

The bitmap has neither problem: no writes when nothing vanished, one sequential scan when something did.

## Consequences

- `reviews` and `card_state` are never touched here, which is what makes the delete safe — a pruned card loses a row, not a history. See [0010](0010-absence-is-not-deletion.md).
- A file that **failed to read** was still enumerated and still has a `files` row, so it counts as a hit and is *not* pruned; its cards keep their last known text until a later sync reads it successfully. Under the generation scheme it would have been treated as absent and pruned. Counting what was *seen* rather than what was *read* is the forgiving choice, and it is the one you want on a path whose failure mode is "your cards vanished".
- The `files` table deliberately carries no per-pass "seen" marker. That is the whole point.
