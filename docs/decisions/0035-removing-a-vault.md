# 0035 — Removing a vault: unlink it, or erase GeodeMD from its notes

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** [ADR 0027](0027-vaults.md)'s "the open vault cannot be removed", and its rule that removal never touches the notes

## Context

**Remove…** took a vault out of the list and, optionally, deleted its database. It refused the open vault and never touched the notes or `.sr/`. That left two gaps:

- **Someone who wants to stop using GeodeMD on a folder** had no way to undo what it wrote there: an `<!-- sr-… -->` comment on every card line, and a `.sr/` folder of logs and annotations. Removing the stamps by hand is a regex over every note, which is the kind of edit the app exists to do carefully.
- **The only vault could never be removed**, and the open one only after switching away, which a one-vault user cannot do.

## Decision

**Two actions, on any vault, the open one and the only one included.**

**Remove from list** (unlink): as before. The vault leaves the list, the database goes if asked, and the notes and `.sr/` stay. Adding the folder again brings the history back.

**Erase GeodeMD from these notes**: every stamp out of every note, `.sr/` deleted, then unlinked with its database. The notes are left as they were before GeodeMD, except for trailing whitespace `stampLine` trimmed.

### What erase takes out, and how

- **Stamps are found by text, not by `parse()`** (`unstamp` in the parser). A stamp outlives the rules that put it there: ` :: ` lines from before ADR 0031, lines now read as code or a table, and sync-conflict copies, which a sync skips but which are the user's notes. The exact stamp shape is matched anywhere on a line, with the one space `stampLine` put before it. Nothing else is touched, and line terminators never are.
- **Every note is written only if unchanged since it was read** (`writeIfUnchanged`). A note being edited is reported, never clobbered.
- **Nothing else is removed while any note still holds a stamp.** Deleting `.sr/` first would leave stamped notes with nothing to say whose they were; stopping leaves the vault listed, so erasing again finishes the job.
- **`.sr/` only as a real directory in the notes root**, never one reached through a symlink.
- **Previewed first, and confirmed by typing the vault's name.** The name is checked in main as well as in the renderer.

### The open vault, and the last one

- **The open vault is closed through `Active.change`** before anything is removed. That refuses while a run is in flight and closes the Store, as a switch does. The first vault left is opened.
- **Removing the last vault leaves a config with no vaults**, which reads as first-run setup. The file keeps `device` and `editor`, and setup reuses that `device`. Minting a new one would split this machine's history across two log files the next time a vault is set up here.

### Where it lives

- **`parser`:** `unstamp`.
- **`core`:** `unstampNotes`, a function and not a method, because it needs no database and must work on a vault that isn't open.
- **`files`:** `describeSr` and `removeSrDir`.
- **`host/erase.ts`:** the order for one folder.
- **`electron/main/removal.ts`:** the order across the folder, the config and an open Store, with no Electron imports so it tests under vitest.

## Options rejected

| option | why not |
|---|---|
| Strip only the stamps `parse()` returns | Misses exactly the stamps nobody can see any more: old `::` lines, code blocks, conflict copies. |
| Delete `.sr/` and the database, leave the stamps | Not "as if never used". Comments in every note are the most visible trace. |
| Run erase as a long run with progress | Erasing is a read and a write per note. A busy button covers it, and it can run on a vault that isn't open, where there's no runner. |
| Keep refusing the open vault | A one-vault user could never leave. |

## Consequences

- **Another device still using the folder will write the stamps back on its next sync.** The confirmation and the guide say to remove the vault there first.
- Erase cannot be undone. The confirmation says so and suggests committing first.
