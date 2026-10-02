# 0034 — Starting a vault fresh: archive the log, and a reset marker

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** [ADR 0005](0005-append-only-review-log.md)'s "every `.jsonl` in `.sr/log/` is read", and [ADR 0010](0010-absence-is-not-deletion.md)'s "never hard-delete from `reviews` or `card_state`", for this one explicit action

## Context

There was no way to give a vault a clean slate. **Rebuild** re-derives the database *from* the review log, so it keeps every review. Deleting the database does the same thing more slowly. Forgetting history meant deleting `.sr/log/` by hand, and that doesn't hold:

- **Another device sharing the folder** has its own shards, and its own database still remembers. A file syncer or `git` can also restore the deleted shards. Any of them folds the old history straight back in, because ingest reads every `.jsonl` in the log whatever its name (ADR 0005, ADR 0021).
- **Deleting is irreversible**, and "I didn't mean to" is a likely second thought.

## Decision

**Start fresh writes a reset marker, then moves the log into an archive, then derives the database again.** Every card is new; card ids and annotations stay; no note is edited.

### The marker is the decision

`.sr/reset.json`, `{ "at": "<ISO>" }`, written first, atomically. It sits beside the log in the notes folder, so it travels to every device and survives the database, the same way the log does (ADR 0001). Two rules follow from it:

- **Ingest skips every review dated before the marker.** It skips them silently, not as bad lines. A restored shard, or one from a device that hasn't caught up, cannot bring old history back.
- **A database whose `meta.reset` differs from the marker is derived again on its next sync**: drop every table, record the marker, read everything. The device that started fresh converges this way, and so does every other device. A crash after the marker is finished by the next sync. A preview writes nothing, so it waits for the real one.

### The log is archived, not deleted

The current shards move whole to `.sr/archive/<at>/log/`. The time has colons replaced, so the folder name is legal on every file system it may sync to. Nothing is rewritten, so ADR 0005's rule holds. `.sr/archive/` sits inside a dotted directory and not `.sr/log/`, so neither the note walk nor ingest reads it.

**Undo is two moves:** put the shards back in `.sr/log/`, delete the marker, sync. The database then differs from the (absent) marker and is derived again with no filter.

### Where it runs

`Core.startFresh(now)` is a long run of its own kind, `fresh`. Like a rebuild it drops the database, so it is refused while anything else runs and nothing joins it. It sits on the Sync screen beside Rebuild, behind the same two clicks and a sentence that says history is archived, not deleted, and that every device follows.

## Options rejected

| option | why not |
|---|---|
| Delete the log | Irreversible, and another device or a syncer restores it anyway. |
| Only record a reset time, and keep the log where it is | Safe and reversible, but the old history stays in `.sr/log/` forever, read and skipped on every ingest. The user asked for it to be put away. |
| Re-mint every card id | Edits every note to achieve what the marker achieves without touching one. |
| Delete annotations too | They aren't review history. Someone starting over still wants their mnemonics. |

## Consequences

- **Ingest reads one small file per run**, and a sync reads it once more at the start. Both are cheap next to a `stat` per shard.
- **A review made on another device just before the fresh start, but after the marker's time, can be archived with its shard.** The shard is moved whole, and a review only reaches the log after it is given, so this needs two devices reviewing within seconds of the reset. It is accepted. The review is in the archive, not lost.
- **Rebuild is unchanged in meaning:** it derives the database from the notes, the log and the marker. The equivalence test now includes `meta.reset`.
- Removing a vault, as opposed to restarting it, is a separate decision.
