# 0027 — Vaults: several notes folders, each with its own database

- **Status:** Accepted
- **Date:** 2026-09-24
- **Supersedes:** the single-`notesPath` config described in [`configuration.md`](../reference/configuration.md) before this change, and the assumption in the setup flow that there is one folder to point at

## Context

GeodeMD had one notes folder at a time. **Change folder…** ([#43](https://github.com/T1Fleming/GeodeMd/issues/43)) could point it somewhere else, but it was built for notes that had moved, not for going back and forth:

- **Every switch walked the whole setup sequence:** pick, confirm, settings, preview, sync.
- **Every switch re-read every note.** All folders shared one database, so pointing it at another folder pruned the old folder's `cards` and `files` rows. That threw away the mtime cache that lets a sync skip unchanged files ([ADR 0008](0008-incremental-sync-costs-what-changed.md)), and switching back read everything again.

Review history did survive, but only as a side effect: the log is in each folder's `.sr/log/`, and `card_state` is never pruned, so a card that came back picked up its schedule. That was a property of the prune rules, not a design for more than one folder.

## Decision

**A vault is a notes folder together with its own database.** The word means exactly that, everywhere — code, UI and docs. "Notes folder" is the folder *inside* a vault. "Collection" survives only as loose prose for the cards in a vault; the screen that was called Collection is now called **Vault**, because it names the vault, and lists and manages the others.

**The config holds a list of vaults and names the active one.** Each vault has an `id`, a `name` (defaulting to its folder's name), a `notesPath` and a `dbPath`. One vault is open at a time.

**Each vault has its own database, so switching is cheap.** Switching closes the current `Store`, opens the other vault's, and changes nothing else. Its cache is intact, so the next sync of an unchanged vault reads no files. `core` and `store` are unchanged: a `Core` already served one folder and one database, and there is still one open at a time.

**What is machine-wide and what is per vault:**

| setting | scope | why |
|---|---|---|
| `device` | machine-wide | It names this machine's log shard, and each vault's `.sr/log/` gets a file under the same name. A name per vault would say nothing new. |
| `editor` | machine-wide | Which app opens a note is about the machine, not the notes ([#47](https://github.com/T1Fleming/GeodeMd/issues/47)). |
| `id`, `name`, `notesPath`, `dbPath` | per vault | That is what a vault is. |

**The switcher is always reachable**: a menu at the end of the tab bar, showing the open vault's name. It is there on the repair screen too, when there is another vault to go to, so a vault on an unplugged drive does not trap the user in it.

**Adding a vault goes through the setup sequence; switching to one does not.** The first sync of a new vault stamps every card line in its folder, and the preview exists for exactly that. A vault already added has already been stamped.

**Change folder… re-points the open vault**, keeping its `id` and its database — the case [`moving-notes.md`](../guides/moving-notes.md) covers. Adding and re-pointing are different actions and look different: one is in the vault list, the other beside the folder path, with a line saying which is which.

**Removing a vault from the list never touches its notes or its log.** Its database is a cache and can be deleted with it; the confirmation says so, and offers it as a separate choice. The open vault cannot be removed — something has to be open afterwards, and which one is the user's call.

### Rules the implementation keeps

**Vaults may not overlap.** A folder inside another vault's folder, or containing one, would put the same stamped cards in two databases. A review in one would be logged in that vault's `.sr/log/`, which the other never reads, so the history would split silently. `host/vaults.ts` refuses it when a vault is added and when one is re-pointed, comparing real paths so a symlink cannot get round it. A folder that does not exist is compared through its nearest existing ancestor: on macOS `/var` is a link to `/private/var`, and an unresolved missing path never matches a real one beside it.

**Migrating a single-folder config never mints a new `device`.** The old config becomes one vault, keeping its `dbPath` where it was, and keeping `device` and `editor`. A new `device` would split this machine's history across two log shards — the failure `settleConfigPath` and `ensureConfig` exist to prevent. The migration is written with the same temp-file-and-rename as every config write, so the file is never half-migrated; if the write fails, the old file is left exactly as it was and the app runs on the migrated config in memory until the next launch tries again.

**A new vault's database goes where it cannot collide:** `$XDG_DATA_HOME/geodemd/vaults/<id>/db.sqlite`. The id is random rather than derived from the path, so a re-pointed vault keeps it and a new vault at its old path does not land on its database. The first vault on a fresh machine keeps the old default, `geodemd/db.sqlite`, so a migrated install and a new one agree about where the first database lives.

**Switching never closes a Store under a running job.** `core` takes no `AbortSignal` ([`app.md`](../design/app.md)), so a switch while a sync or rebuild is running is **refused with a reason** rather than waited out: waiting would leave a click hanging for as long as a rebuild takes, with nothing on screen to say so. A run also cannot start while a switch is part-way through.

**A review in progress ends on a switch**, and its end-of-session "these notes changed" check runs against the vault it was in. Main answers it on the way out, because after the switch that vault's `OpenedNotes` is gone.

## Consequences

- Switching between vaults costs a Store open and an ingest, not a re-read of every note.
- Each vault's history is its own log. **A card moved from one vault to another starts again** — its id travels with the line, but its reviews are in the other vault's `.sr/log/`. Reviewing across several vaults at once is not supported either. Both are out of scope, not oversights.
- **A downgrade cannot read the new config.** A build from before this change sees no top-level `notesPath`, treats the config as absent, and offers first-run setup — which would mint a new `device`. Nobody should downgrade across this change; if someone must, putting `notesPath`, `device` and `dbPath` back at the top level by hand is the whole fix.
- Adding a vault writes the config before its preview, as a first run does, because the dry run reads it. Cancelling afterwards switches back and removes the new vault, database included — the only thing in it is the preview.
- `ErrorKind` gains `refused`: a change to the vault list declined for a reason the user can act on — an overlap, removing the open vault, a sync still running.
