# Keeping several vaults

A **vault** is a notes folder together with its own database. If you keep more than one set of notes — work and personal, or a language you are learning beside everything else — each can be a vault of its own, and you switch between them from the menu at the end of the tab bar.

One vault is open at a time. Reviewing, syncing and the counts on the **Vault** screen are all about the open one.

## What belongs to a vault, and what to the machine

| setting | belongs to | what that means |
|---|---|---|
| notes folder | each vault | The folder its cards are read from, and where its review log lives. |
| database | each vault | Its own cache, so switching back to a vault does not re-read its notes. |
| name | each vault | What the switcher shows. It starts as the folder's name; **Rename…** on the Vault screen changes it. |
| device name | the machine | One per machine, shared by every vault. Each vault's `.sr/log/` gets a file under that name. |
| editor | the machine | What `o` opens a note in, whichever vault it is from. |

A vault's review history is in its own notes folder, in `.sr/log/`, exactly as it was with one folder. Nothing about how a single vault works has changed.

## Adding a vault

Choose **Add vault…** in the switcher, or at the bottom of the vault list on the Vault screen, and pick the folder.

That takes you through the same steps as your first sync: the folder's counts, the settings, a reminder about version control, and a preview. **The first sync of a new vault writes an id into every card line in it**, just as your first sync did — see [Your first sync on an existing collection](first-sync.md) — so the preview is not skipped. You can cancel at any step, and nothing is left behind.

A new vault's database goes in a folder of its own:

```
~/.local/share/geodemd/vaults/<id>/db.sqlite
```

Your first vault keeps its database where it always was.

## Switching

Choose the vault in the switcher. It opens at once: its database already exists, so there is nothing to preview, and **a vault whose notes have not changed reads no notes at all** when you sync it again.

Two things to know:

- **A switch does not wait for a running sync.** If a sync or rebuild is running, the switch is refused with a message saying so. Try again when it finishes — a run cannot be stopped part-way, so closing the vault under it is not an option.
- **A review in progress ends.** Every rating you gave is already recorded. If you opened notes during it and edited them, the app tells you which vault they were in, so you know which one to sync.

## Vaults cannot overlap

A vault's folder cannot be inside another vault's folder, and cannot contain one. Both would put the same cards in two vaults — and a review in one would be recorded only in that vault's log, so the card's history would split in two without anything saying so.

| you have a vault at | adding this | is |
|---|---|---|
| `~/notes` | `~/notes/work` | refused — it is inside `~/notes` |
| `~/notes/work` | `~/notes` | refused — it contains `~/notes/work` |
| `~/notes` | `~/notes` | refused — it is the same folder |
| `~/notes` | `~/notes-archive` | fine — a similar name is not the same folder |

A link to a folder counts as the folder it points to. The same rule applies when you use **Change folder…** on a vault.

If you want work notes kept apart from the rest, make them sibling folders — `~/notes/personal` and `~/notes/work` — rather than one inside the other.

## Change folder… is not Add vault…

**Change folder…** is for when a vault's notes have *moved*: it points the open vault at the new location and keeps its database and history. See [Moving the folder on one machine](moving-notes.md#moving-the-folder-on-one-machine).

**Add vault…** is for a *second* set of notes, kept beside the first.

## Removing a vault

**Remove…** in the vault list takes a vault out of the list. **Its notes and its review log are not touched** — they stay in its folder, and adding that folder again later brings the vault back with its history.

You can also delete its database at the same time. It is a cache: adding the vault again rebuilds it from the notes and the log. The open vault cannot be removed; switch to another first.

## What vaults do not do

- **Review across several vaults at once.** One is open at a time.
- **Carry a card's history to another vault.** A card's id travels with its line if you move it, but its reviews are in the old vault's log. In the new vault it starts again.
