# When something looks wrong

The short version: **your notes and your review log are the real data. The database is a cache, and you can delete it.**

That sentence reads like a trap the first time, so it is worth being precise about why it is not.

## What is actually durable

| | Where | |
|---|---|---|
| **Your cards** | in your notes, as the lines you wrote | durable |
| **Your review history** | `<notes>/.sr/log/<device>-YYYY-MM.jsonl` | durable |
| **Everything else** | `~/.local/share/geodemd/db.sqlite` | a cache |

Both durable halves are plain text inside your notes directory. They are what you back up. If GeodeMD disappeared tomorrow, the first is still an ordinary folder of Markdown and the second is still a readable list of what you reviewed and when.

The database holds **no column that does not come from one of those two**. Card text comes from your notes. Review history comes from the log. Scheduling comes from replaying that history. There is nothing else in there.

## Rebuilding

**Sync → Rebuild.** It asks first, because on a large collection it takes minutes and cannot be stopped once started.

It drops every table and reconstructs the database from your notes and your logs. The test suite asserts this by comparing every table before and after, with no exceptions — that assertion is the reason the claim above is safe to make.

It is slower than a normal sync, because it re-reads everything and replays every review you have ever given. On a large collection, minutes rather than milliseconds. It is the recovery path, not a routine one.

## When to reach for it

**Counts look wrong.** The Collection tab disagrees with what you expect, or a card you know you have is not appearing.

**The database file is gone, or you deleted it.** Nothing is lost. Rebuild.

**You restored an old backup of the database.** Rebuild rather than trusting it — the log has the truth about what you reviewed, and the backup does not.

**After moving your notes directory.** Point GeodeMD at the new folder — it offers to replace the config and keeps your device name — then Rebuild.

**You are not sure.** Rebuilding cannot lose review history, because it reads that history from the log rather than from the database. The worst case is that it takes a few minutes.

## What rebuilding does not fix

**A card you deleted from your notes is gone from the queue**, and rebuilding will not bring it back — the notes are the source of truth for what cards exist.

Its *history* is not gone, though. Review history is keyed on the card's ID and is never filtered by what currently exists, so if you restore that note a year later, the card comes back on its original schedule rather than as new.

**A wrong system clock cannot be repaired.** Reviews are ordered by the timestamp recorded when you gave them, so if your clock was badly wrong, the order is wrong in the log itself and a rebuild faithfully reproduces it.

## Backing up

Copy the notes directory. That is the whole procedure — it contains both your cards and `.sr/log/`.

**Do not put the database under a sync or backup tool.** It lives outside your notes on purpose: a live SQLite file is the worst kind of thing for a syncing tool to copy, and it drags `-wal` and `-shm` siblings along with it. There is nothing in there worth preserving that a rebuild cannot recreate.

## If a sync reports skipped files

```
… 3 files skipped on error
```

A file could not be read — permissions, usually, or a broken symlink. The sync still succeeded and still exits `0`, because one unreadable note should not stop the other twenty thousand. Those cards keep their last known text until a later sync reads the file successfully. They are **not** pruned; GeodeMD counts what it saw, not what it managed to read.

## See also

- [Your first sync on an existing collection](first-sync.md)
- [Moving your notes between machines](moving-notes.md)
