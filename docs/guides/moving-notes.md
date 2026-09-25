# Moving your notes between machines

**GeodeMD has no sync feature, and is not going to get one** ([ADR 0021](../decisions/0021-no-built-in-sync-transport.md)). The unit of sync is your notes directory, and you move it with whatever you already use: Syncthing, Dropbox, iCloud Drive, git, or a USB stick.

That is not a gap being apologised for. Everything two machines need in order to agree is already in the files — which is a claim with tests behind it, not a hope:

- the ID written into each card line **is** its identity, so two machines agree without negotiating
- each machine writes its own review log file, so no file is ever merged
- replaying the same reviews lands both machines on **identical** scheduling, because the FSRS parameters are pinned in source
- re-reading a log you already have is a no-op, so a syncer can deliver the same file twice
- a machine that has never seen the collection catches up completely from the notes and logs alone

This guide is how to do that safely, and what to expect when the same folder is on two machines at once.

## The one rule

**Set up one machine first, let its changes reach the other, and only then run GeodeMD on the second.**

The first sync writes an ID into every card line. If two machines both do that before they have exchanged anything, each invents its own IDs for the same lines — neither is wrong, and neither has anything to agree with.

What that costs is worth being exact about, because the obvious guess is wrong. You do **not** end up with doubled cards: whichever copy of the note wins carries one set of IDs, and the other set disappears when it stops appearing in any note. What you lose is the *review history recorded against the losing IDs* — still in the log, still safe, but now pointing at cards that no longer exist.

No sync tool prevents this, because it happens before the sync tool ever sees a conflict. Stamping once and letting it propagate does.

## Moving to a new machine

Copy the **notes directory**. That is everything: your cards are lines in your notes, and your review history is in `.sr/log/` inside it.

Then on the new machine:

Point GeodeMD at the folder, then **Rebuild** — it reads the notes and the logs and needs nothing else.

`rebuild` reconstructs the database from the notes and the logs you just copied. Scheduling comes back exactly as it was, because it was never in the database in the first place — it is replayed from the log.

**Do not copy the database.** It lives outside the notes directory, it is a cache, and copying it between machines gets you nothing a rebuild does not do more reliably.

**Several vaults?** Each one is its own notes directory, so copy each, then point GeodeMD at the first during setup and add the rest with **Add vault…** ([Keeping several vaults](vaults.md)). Every vault on the new machine shares that machine's one device name, as they did on the old one.

## Moving the folder on one machine

Point GeodeMD at the new location — **Change folder…** at the bottom of the Vault screen, which re-points the open vault and keeps your device name — then **Rebuild**. With several vaults, switch to the one whose notes moved first; the others are not touched.

**Change folder…** is not **Add vault…**. Change folder moves a vault; Add vault keeps a second set of notes beside the first. Using Change folder to reach a different set of notes works, but it re-reads every note each time you go back and forth, which is what vaults exist to avoid.

Replacing the config is an explicit choice, because fixing a path should not double as a way to change the machine's identity. It **keeps your `device` name** and your `editor` setting, which is what you want: the device name is what your log file is called, and regenerating it would scatter one machine's history across two filenames.

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
- **If duplicates predate this** — a conflict copy that was synced before GeodeMD started skipping them — delete the copy and sync again. The duplicate cards disappear with the file. Their history stays in the log, harmlessly, referring to IDs nothing points at any more. GeodeMD will not clean these up for you: telling which of two cards holding the same question is the real one is not a judgement it can make.

## What about reviewing on both machines?

It works, and it is tested — `src/core/two-devices.test.ts` runs exactly this. What it is not is *managed for you*: you are responsible for the folder reaching both ends.

Reviews are recorded to the log first and the database second, both machines append to their own shard, and replay is ordered by when a review happened rather than when it arrived. A machine that was offline for three days folds its reviews in correctly when the files meet.

If you use git, the merge is trivial in a way worth knowing: each machine writes to its own log file, named after its device, so there is nothing for git to merge and no conflict to resolve. Commit and push after a session; pull before one.

The thing that breaks it is a **wrong system clock**. Ordering depends on the timestamp each machine recorded, so a badly wrong clock mis-orders that machine's history permanently, and no rebuild repairs it — the log itself is wrong.

## See also

- [When something looks wrong](recovery.md) — what rebuilding does and does not fix
- [Your first sync on an existing collection](first-sync.md)
