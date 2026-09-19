# 0003 — Cards are keyed on an opaque ID stamped into the note

- **Status:** Accepted
- **Date:** 2026-09-19 (backfilled)
- **Source:** [phase-1 brief](../design/phase-1-brief.md) §4

## Context

A card has to survive its note being edited, moved, renamed and reorganised. The obvious key — file path plus line number — breaks on all four. Any scheme that keys on content breaks the moment a typo is fixed.

So the card needs an identity of its own, which means writing something into the user's note. The question is what.

## Decision

Key on the ID alone. Never on file path, never on line number.

The ID is minted by the ingester and written back into the note as an **HTML comment at end of line**:

```markdown
Default Lambda timeout :: 3 seconds <!-- sr-a7Kd9mQ2xR4v -->
```

Only `<!-- sr-[A-Za-z0-9]{12} -->` at end of line is a stamp. Re-minting replaces an existing stamp rather than appending a second one.

Because the ID is globally unique, moving or renaming a file does not orphan its cards — sync finds the ID at a new path and updates the path column. File path is a mutable attribute, not part of the key.

## Alternatives considered

**A bare `^token` anchor**, as used by one popular editor. Rejected: it is invisible in exactly that editor and renders as visible debris everywhere else, which defeats the portability goal in [0001](0001-plain-text-is-the-durable-store.md). An HTML comment is invisible in every Markdown renderer — GitHub, VS Code preview, pandoc, any static site generator — for about ten characters per stamped line.

The comment also removes an ambiguity a bare token could not: no amount of ordinary answer text can be misread as a stamp, and a line that happens to end with some *other* comment is harmless, since the parser strips trailing comments from the answer and appends its own after them.

## Consequences

- Copied IDs are the real hazard, not minted collisions — duplicating a stamped line is how people write a similar card. Two occurrences in one file: the first in line order keeps the ID. An ID arriving at a new path triggers a read of the old file to distinguish a **move** (update the path) from a **copy** (re-mint the newcomer).
- That read is the only place sync opens a file it did not walk to, and it happens only on a genuine path change.
- `cards.line_no` is a display convenience refreshed each sync. `ParsedCard.lineIndex` is what the stamp write uses. Nothing may key on either.
