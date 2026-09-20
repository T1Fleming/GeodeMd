# Guides

**Written for people using GeodeMD**, not for people working on it. If a reader needs to know how the sync algorithm decides what changed, they want [`docs/design/`](../design/); if they need to know why it works that way, [`docs/decisions/`](../decisions/). See [ADR 0018](../decisions/0018-user-docs-live-in-guides-and-reference.md).

A guide is **task-shaped**: named for what the reader is trying to do, not for the subsystem involved. "Your first sync on an existing collection" is a guide. "How enumeration works" is a design doc.

Things to look up rather than work through — config keys, commands, exit codes — go in [`docs/reference/`](../reference/).

## What belongs here

The situations the [README](../../README.md) can only warn about in a sentence. It stays a front door: install, quickstart, the command table. Anything longer than a screen becomes a guide and gets linked from there.

The ones this project needs first:

- **Your first sync on an existing collection** — the one with real stakes. The first real sync stamps every line in your notes that parses as a card, which on an existing tree is a diff across the whole thing. `--dry-run` and `filesStamped` exist for this, and a sentence in the README cannot carry it.
- **When something looks wrong** — the database is a cache and `geode rebuild` reconstructs it from your notes and logs. Worth saying plainly, because "delete it and rebuild" reads like data loss until you know the database holds nothing that is not derivable.
- **Moving your notes between machines** — what to copy, what not to (the database), and what happens to the review log.

## Writing one

Say what goes wrong as well as what to do. The parts of this tool that need a guide are the parts where the safe path and the obvious path differ — and a guide that only lists the happy path leaves the reader exactly where the README did.
