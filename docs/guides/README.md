# Guides

**Written for people using GeodeMD**, not for people working on it. If a reader needs to know how the sync algorithm decides what changed, they want [`docs/design/`](../design/); if they need to know why it works that way, [`docs/decisions/`](../decisions/). See [ADR 0018](../decisions/0018-user-docs-live-in-guides-and-reference.md).

A guide is **task-shaped**: named for what the reader is trying to do, not for the subsystem involved. "Your first sync on an existing collection" is a guide. "How enumeration works" is a design doc.

Things to look up rather than work through — config keys, commands, exit codes — go in [`docs/reference/`](../reference/).

## What belongs here

The situations the [README](../../README.md) can only warn about in a sentence. It stays a front door: install, quickstart, the command table. Anything longer than a screen becomes a guide and gets linked from there.

- **[Reviewing](reviewing.md)** — what the four ratings mean, when `hard` is the honest key rather than `again`, why a card comes back in the same session, and what `0 later` does that no rating can.
- **[Your first sync on an existing collection](first-sync.md)** — the one with real stakes. The first real sync stamps every line in your notes that parses as a card, which on an existing tree is a diff across the whole thing.
- **[When something looks wrong](recovery.md)** — the database is a cache and **Rebuild** reconstructs it from your notes and logs. Worth saying plainly, because "delete it and rebuild" reads like data loss until you know the database holds nothing that is not derivable.
- **[Moving your notes between machines](moving-notes.md)** — what to copy, what not to, and the conflict-copy problem that nothing filters for you.
- **[Keeping several vaults](vaults.md)** — more than one notes folder, each with its own database, and why two of them may never overlap.

## Something to try them on

[`demo/`](../../demo/) is a collection of notes with 23 cards in it, including a file that deliberately exercises the shapes the parser skips. Copy it rather than syncing it in place.

## Writing one

**These guides are tested.** Each one has a journey in `src/journeys/` that reads it and checks what it claims — the key tables, the intervals, the example card lines, the paths, the filenames it promises to recognise. If you change a claim here and `npm test` fails, one of the two was wrong, and the test names which. Write tables rather than prose where a number or a key is the point, because a table can be checked and a sentence often cannot.

Say what goes wrong as well as what to do. The parts of this tool that need a guide are the parts where the safe path and the obvious path differ — and a guide that only lists the happy path leaves the reader exactly where the README did.
