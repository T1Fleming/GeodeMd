# 0029 — Annotations: one plain-text file per card, beside the log

- **Status:** Accepted
- **Date:** 2026-09-24
- **Amends:** [ADR 0001](0001-plain-text-is-the-durable-store.md)'s list of what is durable

## Context

Once a card's answer is showing, there was nowhere to put what reviewing it taught you: a mnemonic, why you keep confusing it with another card, a source, an example. The only way out was `o`, which means writing it into the note beside the card. That mixes remarks *about* the card into the user's own writing, and nothing written there comes back at review: a card is one line ([ADR 0002](0002-one-line-card-syntax.md)).

"Note" already means the user's Markdown file everywhere — `note/open`, "open the card's note", `notesPath`, the guides. This feature is called **annotation** in code, IPC and docs so that none of those become ambiguous, and its key is `a` rather than `n`.

## Decision

**Each card may have an annotation, stored as one Markdown file named by its stamp: `<notes folder>/.sr/annotations/<card-id>.md`.**

This adds a third kind of durable state to ADR 0001's list: card content in the notes, review history in `.sr/log/`, and now annotations in `.sr/annotations/`. Like the log, they are plain text inside the notes folder, so they travel with it, and like the log they are per vault ([ADR 0027](0027-vaults.md)).

**The database is not involved.** Revealing a card reads its file, for the marker; saving writes it. The file is the whole store, so sync, `rebuild`, the schema and the "rebuild reproduces the database exactly" test do not change. Enumeration already skips every dotted directory, so nothing under `.sr/annotations/` can be read as a card or stamped — even a line in an annotation that contains ` :: `.

**Keyed by the stamp**, which is stable across edits to the card's wording ([ADR 0003](0003-stamp-identity-into-the-note.md)). `files/` checks the id against the stamp's shape before it becomes part of a path, so no string can turn into `../`.

**Written atomically**: a temp file in the same directory, fsynced, then renamed over the old one. A crash leaves the previous annotation or the new one, never half a file.

### Only after the answer is revealed

`a` is offered at the answer stage only, and the annotation is never shown at the question. An annotation is free to restate the answer, so showing it before the reveal would make that card's review a sham test — the mirror image of why [ADR 0022](0022-defer-a-card-without-rating-it.md) keeps `0` question-only.

At the question `a` does nothing at all, not even the reveal every other key performs: someone reaching for their annotation must not be shown the answer they had not tried yet.

The panel is hidden by default and never opened automatically. When a card has an annotation, the answer stage shows a small marker so you know it is there. Whether it has one is a fetch when the card is revealed, not a field on `DueCard`, so building the queue does not cost a `stat` per card.

### Typing into the box must not review the card

The review screen is one keyboard surface: `1`–`4` rate, `q` and `Escape` quit, and the document listener calls `preventDefault` on every key. So **annotating is a session state**, not a detail of a component. While the box is open, the review keys mean nothing — no rating, no reveal, no quit, no defer, no open — and the listener lets every key through to the text box except the two that close it.

**`Escape` saves and closes. So does Cmd+Enter.** Everywhere else on the review screen `Escape` quits; here it closes the box and keeps the session going. It saves rather than discards because losing typed text is the worse surprise of the two: a save you did not want is one more `a` away from being undone, and discarded text is gone. There is no key that closes without saving.

Closing an unchanged box writes nothing, so a file syncer does not see an edit that did not happen. Leaving the review tab with the box open saves it too, for the same reason `Escape` does.

**A failed save is reported and keeps the text in the box.** It is never silently dropped.

**Switching vault with the box open saves it first, into the vault it was written in, and waits.** Unmounting the box without that save would lose the text, and saving after the switch would file it in the other vault's `.sr/annotations/`. **If that save fails, the switch does not happen**: the box stays open with the text and the reason, as any failed save leaves it. The same applies to adding a vault from the tab bar, which leaves the review screen for the setup sequence.

**A save also names its vault**, as a backstop. One that arrives after a switch anyway is refused rather than written into the vault that is open by then, where it would sit under an id from another notes folder.

## Options rejected

| option | why not |
|---|---|
| Indented lines under the card, in the note | Needs a multi-line card body, which ADR 0002 excludes. The app would also be writing prose into the user's files, possibly while that file is open in an editor from `o`. |
| SQLite only | Breaks ADR 0001: `rebuild` would delete annotations, and the database is not synced across devices. |
| Append-only JSONL per device, like the review log | No syncer conflicts, but it needs an ingest step, a table and a replay rule, and it cannot be read or edited outside the app. Too much machinery for a text box when per-card files already make conflicts rare. |

## Consequences

- **Two devices editing the same card's annotation before syncing produce a conflict copy** — `sr-….sync-conflict-….md` beside the original. It is rare, because each card has its own file, and it is the same exposure notes already have. **These copies are out of scope for [ADR 0019](0019-report-sync-conflict-copies.md)'s reporting**, and deliberately so: enumeration never walks `.sr/`, so sync neither counts nor reads them. A conflict copy of an annotation cannot duplicate a card the way a copied note does — nothing reads it — so the harm ADR 0019 exists to prevent does not arise. The copy simply sits there until the user merges it by hand.
- **Deleting a card orphans its annotation file**, deliberately. It matches [ADR 0010](0010-absence-is-not-deletion.md): restore the card and its annotation comes back with it, as its history does.
- **Copying a card line gives the copy a new id**, so the copy starts with no annotation and the original keeps its own.
- **Empty text deletes the file** — blank, whitespace only — rather than leaving a zero-byte file that would make the card look annotated.
- **Stored as written.** Plain text, no trimming, no newline added: a CRLF annotation stays CRLF.
- **Obsidian and other tools that hide dot-directories hide annotations too.** They are ordinary files and can be read or edited in any editor that shows `.sr/`.
- Out of scope: searching annotations, listing the cards that have one, and showing or editing them anywhere but the review screen.

## Source

Issue [#49](https://github.com/T1Fleming/GeodeMd/issues/49).
