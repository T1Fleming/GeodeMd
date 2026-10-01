# Parser and card identity

`src/parser/index.ts`. Pure: a string in, `ParsedCard[]` out. No filesystem, no database, no clock.

## RemNote's syntax, Markdown's structure

GeodeMD reads RemNote's card types, but the notes are Markdown and stay Markdown. So the two get one job each:

- **RemNote decides what the tokens mean.** `>>`, `==`, and later `::`, `;;` and the rest, mean what they mean in RemNote ([ADR 0031](../decisions/0031-forward-cards-and-context.md)).
- **Markdown decides the structure**: which lines are cards at all, and what is nested under what. A line is nested only when Markdown renders it as a nested list item ([ADR 0030](../decisions/0030-nested-bullets-are-not-code.md)).
- **When the two could disagree, the line is not a card.** The parser is stricter than CommonMark, never looser: a false positive writes a stamp into the note.

The case where this costs something is RemNote's habit of nesting by indentation alone:

```markdown
Now we are >> Going to see
    If we can look at
    Nested things
    Like >> This
```

RemNote reads the last three lines as children of the first, and makes two cards. Markdown reads them as more of the first line's paragraph — an indented code block cannot interrupt a paragraph — and renders all four as one line. GeodeMD makes **one** card, from the first line. The same outline with list markers is two cards, nested, in GeodeMD and in every Markdown viewer.

Because a skipped card is otherwise invisible, `parseNote` reports these lines (`unnested`): a card-shaped line skipped as indented, directly under a line of text. Sync counts them and names the first ten (`cardLinesUnnested`, `unnestedAt`), and `host`'s `unnestedReason` says what to do. An indented line after a blank line is an indented code block, as Markdown has it, and is not reported — so `echo done >> run.log` in a script does not show up as a card someone forgot to nest.

## Recognising a card

A card is a single line containing ` >> ` or ` == ` — RemNote's forward card ([ADR 0031](../decisions/0031-forward-cards-and-context.md)). Everything before the **first** separator of either kind is the question, everything after it is the answer, both trimmed.

The separator is matched with lookaround — `/(?<=\s)(?:>>|==)(?=\s)/` — so it requires whitespace on both sides. `a>>b` in code is not a card. A second separator on the same line is ordinary answer text: one line is always at most one card.

Two things fall out of the whitespace rule and are promised rather than incidental. **A backslash keeps a separator literal**: in `x \== y` the `==` has a backslash before it, not whitespace, and Markdown renders the note as `x == y`. And **RemNote's longer tokens are not forward cards** — `>>>`, `>>-`, `==-`, `>>A)`, `==A)`, `>>1.` — because none has whitespace after its first two characters. They mean other card types, which are not read yet.

**` :: ` is not a card.** RemNote reads it as a Concept card, tested in both directions, and it is kept for that. Until then a ` :: ` line is only text, though as a parent it still shows only its term (below).

Before splitting, a leading list marker is stripped from the question — bullet or ordered, each optionally followed by a task box:

```
/^(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/
```

So `- [ ] Cold start cause >> a new execution environment` yields the question `Cold start cause`, not `- [ ]  Cold start cause`.

Both sides must be non-empty after trimming, or the line is not a card.

## Skipped contexts

Six shapes are never read as cards. Each is one line-level predicate:

| Shape | Test |
|---|---|
| Fenced code block | ` ``` ` or `~~~`, 3+ chars; a closing fence must use the same character, length may differ |
| Indented code block | 4+ columns past the text of the list item it sits in, or past the margin outside a list |
| Inline code span | odd number of backticks before the separator |
| Table row | `/^[ \t]*\|/` |
| YAML frontmatter | between `---` on line 1 and the next `---` |
| Blockquote or heading | `/^[ \t]*[>#]/` |

A line 4+ columns from the margin is read only when it opens a list item, nested under another one. The parser keeps the column at which each open item's text starts. Tabs advance to the next multiple of four, as in CommonMark. A heading, paragraph, fence or horizontal rule at the margin closes the list, and blank lines between items do not. Indented text that is not a bullet stays skipped, and so does a bullet deep enough that Markdown renders it as code inside the item. Where CommonMark is more permissive, for example a lazy continuation line, the parser closes the list instead. The rule and the simpler one it rejected are [ADR 0030](../decisions/0030-nested-bullets-are-not-code.md).

Frontmatter only counts when `---` opens line 1 **and** a closing delimiter exists; without one, the file has no frontmatter and the parser does not swallow the whole note.

This list is longer than a card parser looks like it needs. The reason is that a false positive here does not merely produce a junk card — sync writes a stamp into the line, so a false positive **edits the user's note**. See [ADR 0002](../decisions/0002-one-line-card-syntax.md).

## Context

Each card carries `context`: the headings above it, then the list items it is nested under, outermost first. Each entry says which it is, `kind: "heading"` or `"item"`, because the review screen puts headings on the path line and items in the outline above the question ([ADR 0032](../decisions/0032-show-parents-as-remnote-does.md)). The note's name is added by `host`, which knows the path.

- **Headings form a stack.** A heading at level *n* replaces the previous one at *n* and clears everything deeper. Only a heading outside a list counts — the open-item stack is empty after the margin check. One inside a list item belongs to that item.
- **Parent bullets are the open list items**, from the same stack ADR 0030 keeps for the indentation rule, so a sibling is never a parent and a paragraph, heading or fence at the margin ends the path.
- **What an ancestor shows:** a forward card, its question and its answer, as RemNote shows a Basic parent; a ` :: ` line, only what is before the `::`, as RemNote shows a Concept parent; anything else, its text. Each is cleaned the way a question is — marker, task box, trailing comments and stamps off, trimmed — and an empty one is left out.
- **Nothing in a skipped context is context**: a heading in a fence, a blockquote or frontmatter is not one, and `#tag` with no space after the `#` is not a heading.

Two versions name the rules. `SYNTAX_VERSION` covers which lines are cards: bump it when the same note would yield different cards. `CONTEXT_VERSION` covers context alone: bump it when the cards stay the same but their context does not. Either makes the next sync read every note once ([data model](data-model.md)). Only a syntax bump makes the app warn first, because only that kind can stamp new lines.

## Stamps

A stamp is an HTML comment at end of line holding `sr-` plus exactly twelve characters from `[A-Za-z0-9]`:

```
/<!-- (sr-[A-Za-z0-9]{12}) -->[ \t]*$/
```

That is the *only* shape that is a stamp. Any other trailing HTML comment is stripped from the answer but is not an identity — a line ending `... 3 seconds <!-- TODO check -->` is a card whose answer is `3 seconds`. Stripping repeats until no trailing comment remains, so several in a row are all removed.

Order matters in `parseLine`: the stamp comes off first so it is never mistaken for answer text, then other trailing comments come off after it.

`stampLine` **replaces** an existing stamp rather than appending. The naive implementation reuses the append path and produces `<!-- sr-old --> <!-- sr-new -->`, so replacement is written explicitly and `ID_PATTERN` is validated before writing.

## Line terminators

`splitLines` splits *after* the newline — `/(?<=\r?\n)/` — so every line carries its own terminator, and rejoining is plain concatenation.

This is why a CRLF file stays CRLF and a file with no trailing newline keeps that. Splitting on `\n` and rejoining with `join("\n")` silently converts a whole note the first time one card in it is stamped, which shows up as a full-file diff in git and a full re-transfer in whatever syncs the directory.

`stampLine` takes a line *body* only. The terminator is the caller's business, for the same reason.

## Identity

Cards are keyed on the ID alone — never on file path, never on line number. Because the ID is globally unique, moving or renaming a file does not orphan its cards: sync finds the ID at a new path and updates the path column.

Twelve characters rather than eight is a scale decision with a specific number behind it; see [ADR 0004](../decisions/0004-twelve-character-ids.md). The choice of an HTML comment over an editor-specific `^token` anchor is [ADR 0003](../decisions/0003-stamp-identity-into-the-note.md).

Duplicate IDs are resolved by sync, not by the parser — see [sync.md](sync.md).
