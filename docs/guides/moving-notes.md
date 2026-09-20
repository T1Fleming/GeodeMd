# Moving your notes between machines

GeodeMD is a single-machine tool today. There is no sync feature, and this guide is not one — it is how to move a collection without losing scheduling, and what to expect if the same folder ends up on two machines.

## Moving to a new machine

Copy the **notes directory**. That is everything: your cards are lines in your notes, and your review history is in `.sr/log/` inside it.

Then on the new machine:

```sh
geode init /path/to/notes
geode rebuild
```

`rebuild` reconstructs the database from the notes and the logs you just copied. Scheduling comes back exactly as it was, because it was never in the database in the first place — it is replayed from the log.

**Do not copy the database.** It lives outside the notes directory, it is a cache, and copying it between machines gets you nothing a rebuild does not do more reliably.

## Moving the folder on one machine

```sh
geode init /new/path --force
geode rebuild
```

`--force` is needed because `init` refuses to overwrite an existing config — being re-runnable to fix a path should not double as a way to change the machine's identity. It **keeps your `device` name** and your `editor` setting, which is what you want: the device name is what your log file is called, and regenerating it would scatter one machine's history across two filenames.

## If the same folder is on two machines

This is the case to be careful about, because it half works.

**What survives it.** The review log is append-only and one file per device per month, so two machines write to two different files and never collide. Ingest reads every `.jsonl` in the directory, so whichever machine sees both files folds both histories in. Duplicate lines are recognised as reviews already held rather than counted twice.

That much is deliberate — the layout was designed so a second machine is additive rather than a migration.

**What does not, automatically.** Your *notes* have no dedupe key. A conflict copy is a byte copy, so every card in it already carries an ID — and a fresh ID minted into the copy would give you a duplicate of every card in that note, with its own empty history.

**GeodeMD now leaves recognised conflict copies alone and tells you it did** ([ADR 0019](../decisions/0019-report-sync-conflict-copies.md)). A sync that finds one says so:

```
412 files (410 unchanged, 2 read), 8 cards found, 0 new, 0 updated, 1 sync conflicts left alone — 31ms
```

It recognises Syncthing's `note.sync-conflict-20260101-120000-ABCDEFG.md` and the `(conflicted copy …)` form Dropbox and Nextcloud use. It deliberately does **not** recognise `note 2.md` or `note (1).md` — iCloud and Google Drive really do name conflicts that way, and so do a great many people naming files on purpose. Silently ignoring a note you meant to keep is a worse failure than a duplicate card, which is at least visible.

So the copy is still there, still holding your other version, and still yours to resolve. Nothing about it has been changed.

**If you sync your notes folder between machines:**

- Sync when GeodeMD is not running on either side.
- When a sync reports conflicts left alone, deal with them: merge whichever changes you want into the real note and delete the copy.
- **If duplicates predate this** — a conflict copy that was synced before GeodeMD started skipping them — delete the copy and run `geode sync` again. The duplicate cards disappear with the file. Their history stays in the log, harmlessly, referring to IDs nothing points at any more. GeodeMD will not clean these up for you: telling which of two cards holding the same question is the real one is not a judgement it can make.

## What about reviewing on both machines?

It works better than it has any right to, and it is still not a supported feature.

Reviews are recorded to the log first and the database second, both machines append to their own shard, and replay is ordered by when a review happened rather than when it arrived. A machine that was offline for three days folds its reviews in correctly when the files meet.

The thing that breaks it is a **wrong system clock**. Ordering depends on the timestamp each machine recorded, so a badly wrong clock mis-orders that machine's history permanently, and no rebuild repairs it — the log itself is wrong.

## See also

- [When something looks wrong](recovery.md) — what rebuilding does and does not fix
- [Your first sync on an existing collection](first-sync.md)
