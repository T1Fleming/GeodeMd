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

**What does not.** Your *notes* have no such protection. If a file syncer produces a conflict copy — `note.sync-conflict-20260101.md`, `note (conflicted copy).md` — GeodeMD reads it as a new file and **mints a fresh card for every stamped line in it**, then writes those stamps into the copy. You get duplicate cards with separate histories.

Nothing filters those out, because which pattern to filter depends on which tool you use, and GeodeMD does not know.

**So, if you sync your notes folder between machines:**

- Sync when GeodeMD is not running on either side.
- Resolve conflict copies **before** running `geode sync`, not after.
- If a conflict copy does get synced, delete it and run `geode sync` again — the duplicate cards disappear with the file. Their history stays in the log, harmlessly, referring to IDs nothing points at any more.

## What about reviewing on both machines?

It works better than it has any right to, and it is still not a supported feature.

Reviews are recorded to the log first and the database second, both machines append to their own shard, and replay is ordered by when a review happened rather than when it arrived. A machine that was offline for three days folds its reviews in correctly when the files meet.

The thing that breaks it is a **wrong system clock**. Ordering depends on the timestamp each machine recorded, so a badly wrong clock mis-orders that machine's history permanently, and no rebuild repairs it — the log itself is wrong.

## See also

- [When something looks wrong](recovery.md) — what rebuilding does and does not fix
- [Your first sync on an existing collection](first-sync.md)
