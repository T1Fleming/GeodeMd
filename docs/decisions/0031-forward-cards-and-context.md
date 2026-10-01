# 0031 — RemNote's forward card: `>>` and `==`, with its parents above it

- **Status:** Accepted
- **Date:** 2026-10-01
- **Amends:** [ADR 0002](0002-one-line-card-syntax.md)'s "exactly one form is recognised: ` :: `"
- **Amended by:** [ADR 0032](0032-show-parents-as-remnote-does.md) — parents are shown as an outline under a path line, not as one breadcrumb

## Context

GeodeMD is to read RemNote's card syntax, one card type at a time ([research note](../research/remnote-card-types.md)). Its one card form was `question :: answer`, read as a one-way card. RemNote reads ` :: ` as something else: a **Concept** card, tested in both directions, whose definition is hidden when it is shown as the parent of another card. Keeping ` :: ` as a one-way card would leave the real Concept card nowhere to land, and every vault would hold lines that mean one thing here and another in RemNote.

A question was also shown alone. RemNote shows it under its parents, so a short `Nucleolus >> makes ribosomes` arrives under `Cell › Nucleus`. Without that, outline-style notes need long questions that stand on their own. [ADR 0030](0030-nested-bullets-are-not-code.md) made deep bullets cards so that this would be worth doing ([#61](https://github.com/T1Fleming/GeodeMd/issues/61), [#63](https://github.com/T1Fleming/GeodeMd/issues/63)).

## Decision

### `>>` and `==` are the forward card, and ` :: ` is not a card

**`question >> answer` and `question == answer` each make one forward card**, RemNote's Basic card in its default direction. Everything else in ADR 0002 stands: whitespace on both sides, the first separator splits the line, list markers and task boxes come off the question, and the skip list is unchanged.

The whitespace rule also keeps out RemNote's longer tokens — `>>>`, `>>-`, `==-`, `>>A)`, `==A)`, `>>1.` — whose meanings come later. None of them has whitespace directly after its first two characters.

**A backslash keeps a separator literal.** `x \== y` is not a card, because the `==` has a backslash before it rather than whitespace. Markdown renders `\=` as `=`, so the note still reads `x == y`. This costs no rule of its own. It is written down here because it is now a promise, with its own tests and a line in the guide.

**` :: ` is not a card until the Concept card exists.** A stamped ` :: ` line drops out on the next sync. Its history stays, by [ADR 0010](0010-absence-is-not-deletion.md). Changing it to ` >> ` with the stamp left in place brings the card back on its old schedule.

### A card's context is the path from its note down to it

The note's name, then the headings above the card, then the list items it is nested under, outermost first.

- **The parser computes it**, because it depends on the note's text alone: `ParsedCard.context`. The note's name is not the parser's to know, so `host` adds it from the path.
- **Headings form a stack.** A `##` replaces the last `##` and clears everything deeper. Only a heading outside a list counts; one inside a list item belongs to that item.
- **A bullet's parents are the open list items** that ADR 0030's indentation stack already tracks.
- **What a parent shows follows RemNote.** A forward card shows its question and its answer. A ` :: ` line shows only what is before the `::`, which is what a Concept parent will show. Any other bullet shows its text. Each is cleaned the way a question is.
- **Stored, not recomputed:** `cards.context`, as JSON. Reading the note for every card served would cost a file read each and could disagree with the stored line number. Because it derives from the notes alone, a rebuild reproduces it.
- **A change to it is a change to the card.** Editing a parent rewrites its children's context without touching their lines, so sync compares it alongside the question and answer.
- **Shown above the question at both stages**, joined and shortened by `host/present.ts`'s `breadcrumb`.

### A change of syntax re-reads every note, once

The mtime cache never re-reads an untouched note, so neither the retirement of ` :: ` nor the new column would reach most of a vault. **The parser has a `SYNTAX_VERSION`, recorded in `meta`** the way [ADR 0028](0028-move-to-fsrs-6.md) records the scheduler's. A sync against an older version, or against none, reads every note. Only a real sync that read every note without an error records the new version, so a preview leaves the debt in place and a note that could not be read is tried again next time.

**That sync can stamp lines that were never cards.** Prose such as `x == y` is the likely case. A first sync is behind a preview; this one is not, because the vault already exists. So opening a vault whose version is old says so and takes the user to the Sync screen, where the Preview button is. A preview now also counts the cards a re-read would prune, which after this change are the ` :: ` lines.

## Options rejected

| option | why not |
|---|---|
| Keep ` :: ` as a one-way card forever | GeodeMD would read RemNote's most common card type as something it is not, and the Concept card would need a separator RemNote does not use. |
| Keep reading stamped ` :: ` lines until the Concept card lands | Two meanings for one separator at once, and a second migration later. A clean break is one guide section and one find-and-replace. |
| `>>` only, leaving `==` for later | RemNote's editor types `==` for the same card. The extra false positives are what the preview and the escape exist for. |
| Show only a parent's question, never its answer | Safer when a parent's answer gives the child's away. RemNote shows it, and the Concept card is RemNote's answer to that problem. |
| Re-read on every sync until the user previews | A gate the user cannot see. A note that names the change and a screen with a Preview button on it does the same work in the open. |

## Consequences

- **Every existing vault's next sync reads every note** and may stamp new lines. That is the point of the change, and the reason it is recorded.
- **Lines that were ` :: ` cards leave the queue** until they are converted. The guide gives the conversion as one command.
- `type` stays `'basic'`. A direction lands with the first card that goes both ways, which must also settle how one stamped line holds two cards.
- Out of scope: `<<`, `<>`, disabled cards, Concept and Descriptor cards, multi-line, list, multiple-choice, cloze and image-occlusion cards, and a clickable breadcrumb.

## Source

Issue [#63](https://github.com/T1Fleming/GeodeMd/issues/63), which absorbs [#61](https://github.com/T1Fleming/GeodeMd/issues/61).
