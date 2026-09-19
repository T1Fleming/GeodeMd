# Sync

`Core.sync(now, opts)` in `src/core/index.ts`. A batch operation: it runs on demand and holds no resident process.

```ts
sync(now: Date, opts?: { full?: boolean; dryRun?: boolean; onProgress?: ... })
```

The organizing rule has two halves, and the second is the one that is easy to miss:

> A sync costs what **changed**, not what exists — and a sync that finds nothing changed must also **write** nothing.

See [ADR 0008](../decisions/0008-incremental-sync-costs-what-changed.md).

## The seven steps

The code carries these step numbers as comments, so they are the same landmarks in both places.

### 1. Enumerate — the seam

Produce `(path, mtime, size)` for every `.md` file, walking recursively and sorting directory entries so order is deterministic across machines. Skips:

- any **dotted directory** — covering `.git/`, `.sr/`, and editor leftovers without naming any of them
- non-`.md` files
- **directory symlinks**, which are counted in the summary

This step is the only part of the design that knows how changes are discovered; everything downstream consumes a list. That is deliberate — see [ADR 0011](../decisions/0011-enumeration-is-a-seam.md) for why it is a seam and what would replace a walk.

### 2. Classify — one indexed read, no write

Against the `files` table:

| Condition | Outcome |
|---|---|
| row exists, `(mtime_ms, size)` both match, no `--full` | **unchanged** — skip without opening |
| row exists, they differ | changed |
| no row | new |

`rowid` is selected alongside, because step 6 needs it. As classification proceeds it counts `hits` and sets each found row's bit in an in-memory bitmap — 125 KB at a million files.

`(mtime, size)` is a heuristic, and where it is wrong it is **silently** wrong: a tool that rewrites a file while preserving its mtime leaves stale cards forever. That is what `--full` is for.

### 3. Read and parse

Collect `ParsedCard[]` for each changed or new file. An ID seen twice within one file is resolved here: the first in line order keeps it, later ones are treated as unstamped.

### 4. Defer, mint, write

If the file's mtime is within 2 seconds **of the stat taken in step 2** — not of the sync's start, which at scale may be minutes earlier — the file is **deferred**: cards already carrying IDs are reconciled, and nothing is minted. It is likely open in an editor.

Otherwise mint IDs for unstamped lines and apply all stamps for the file in **one write**, reconstructing it from its lines with each line's own terminator preserved (see [parser.md](parser.md)).

Immediately before writing, **stat the file again and skip the write if `(mtime, size)` differs from step 2.** The deferral guard does not cover a file edited in the milliseconds after it was read, and the failure mode is silently reverting the user's keystrokes. Size is compared as well as mtime because mtime granularity is one second on some filesystems, and this is a write path that destroys typing when it guesses wrong.

After a successful write, re-stat and record the **new** `(mtime, size)`. Recording the pre-write values would make the file look changed on every subsequent sync, forever.

### 5. Reconcile the file's cards

Upsert into `cards`, **only for cards whose ID is now on disk and was written or confirmed this pass.** Nothing minted but unwritten may enter the database.

An ID whose stored row names a *different* path triggers a move-versus-copy check: read that one file. If the ID is no longer there, it is a **move** — update the path. If it is still there, it is a **copy** — the newcomer is re-minted. This is the only place sync reads a file it did not walk to, and only on a genuine path change.

If the parsed question or answer differs from the stored row, update them but **leave `card_state` untouched** — a typo fix must not reset scheduling.

Then delete the file's vanished cards, scoped by path:

```sql
DELETE FROM cards WHERE file_path = ? AND id NOT IN (<ids parsed from it>)
```

Scoping by path is what makes this safe against ordering: a card that moved to another file already had its path updated, so it is no longer matched here, whichever order the two files were walked in.

### 6. Prune — and usually decide not to

Compare `hits` against `known`, the row count of `files` taken **before** the walk began:

- **`hits == known`** — nothing vanished. **Stop.** A sync that found no changes has now written nothing at all.
- **`hits < known`** — scan `files` by rowid once; every row whose bit is unset is gone. Delete their `cards` rows, then their `files` rows.

`reviews` and `card_state` are never touched here, which is exactly what makes the delete safe. See [ADR 0009](../decisions/0009-prune-by-bitmap-and-count-check.md) and [ADR 0010](../decisions/0010-absence-is-not-deletion.md).

A file that **failed to read** was still enumerated and still has a `files` row, so it counts as a hit and is not pruned — its cards keep their last known text.

### 7. Ingest logs

For each `.jsonl` in `<notes>/.sr/log/`, stat it and compare to its `log_files` row:

- `offset == size` → nothing new; **do not open the file.** This is what makes frozen monthly shards free to skip.
- `size < offset` → truncated or replaced; reset to 0 and read whole. `INSERT OR IGNORE` makes that harmless.
- otherwise read from `offset` to EOF.

**Advance the stored offset to the end of the last newline-terminated line, never to EOF.** A truncated final line will be completed by the next append, and an offset past it would skip the completed line forever.

Collect the card IDs where a row **actually inserted**, and replay exactly that set. Two rules govern the replay:

- **Which cards to replay is decided by what inserted — never by comparing timestamps.** A machine offline for three days produces reviews that are all *older* than what is already folded in, so a "newer than `last_review`" test would skip them permanently.
- **How to replay a given card is free**, because the scheduler is a pure fold. If every newly-inserted review is strictly newer than `card_state.last_review`, fold onto existing state; otherwise replay the card's full history from zero.

Read history `ORDER BY rated_at` — a range scan, since it is the primary key. Skip IDs with no card row, and set `cards.reviewed = 1` in the same transaction.

Step 7 **never writes to the notes directory**, which is what lets `review` and `stats` run it implicitly.

## Invariants

**An ID exists in the database only if it exists on disk.** Mint, write, then upsert — never mint, skip the write, and upsert anyway. The wrong order means a card authored in an open file gets a row, loses the stamp, is re-minted next pass as a second card, and the first row is pruned: every card written into an open file grows a ghost twin that survives exactly one sync.

**Two concurrent syncs are safe by construction and must not acquire a lock.** The re-stat before each write means the second process skips whatever the first already wrote, and WAL plus the busy timeout serializes SQLite. This is written down so nobody adds a lock file to fix a problem that does not exist.

**The shape of a no-op sync:** one `stat` per file, one indexed read per file, one `COUNT(*)`, one `stat` per log shard. No writes, anywhere.

## Failure handling

Two failures are handled differently on purpose.

A `notesPath` that is missing or is not a directory is a **configuration error**: fail loudly, exit non-zero. Every count the run would report is meaningless, and an empty directory would otherwise prune the entire collection.

An individual file that cannot be read or parsed is **skipped and counted**, never fatal. One bad file must not stop the other twenty thousand. The same asymmetry governs the log: a missing log directory is a first run; a single unreadable line is a skip.

**Exit codes:** `0` on success *including* skipped files, `1` for a configuration or usage error, `2` for an unexpected internal error. Partial failure is communicated in the summary, not the exit status.

## `--dry-run` and `--full`

`--dry-run` writes nothing — not a stamp, not a row — and returns the summary the real run would have produced. It is not a debugging aid: **the first sync of an existing collection rewrites every file containing a card**, because every card is unstamped.

`--full` forces every candidate through steps 3–5, ignoring the mtime cache. It is the answer to a tool that rewrote files while preserving mtimes.

## Summary

`SyncSummary` reports files enumerated / unchanged / read / deferred, cards found / new / updated / pruned, whether the reconciliation pass ran, duplicates re-minted, symlinked directories skipped, log shards skipped, log bytes read, reviews ingested, files skipped on error, log lines skipped, and elapsed milliseconds.
