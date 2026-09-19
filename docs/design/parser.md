# Parser and card identity

`src/parser/index.ts`. Pure: a string in, `ParsedCard[]` out. No filesystem, no database, no clock.

## Recognising a card

A card is a single line containing ` :: `. Everything before the **first** separator is the question, everything after it is the answer, both trimmed.

The separator is matched with lookaround — `/(?<=\s)::(?=\s)/` — so it requires whitespace on both sides. `foo::bar` in code or a `key::value` field is not a card. A second ` :: ` on the same line is ordinary answer text: one line is always at most one card.

Before splitting, a leading list marker is stripped from the question — bullet or ordered, each optionally followed by a task box:

```
/^(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/
```

So `- [ ] Cold start cause :: a new execution environment` yields the question `Cold start cause`, not `- [ ]  Cold start cause`.

Both sides must be non-empty after trimming, or the line is not a card.

## Skipped contexts

Six shapes are never read as cards. Each is one line-level predicate:

| Shape | Test |
|---|---|
| Fenced code block | ` ``` ` or `~~~`, 3+ chars; a closing fence must use the same character, length may differ |
| Indented code block | `/^(?: {4}|\t)/` |
| Inline code span | odd number of backticks before the separator |
| Table row | `/^[ \t]*\|/` |
| YAML frontmatter | between `---` on line 1 and the next `---` |
| Blockquote or heading | `/^[ \t]*[>#]/` |

Frontmatter only counts when `---` opens line 1 **and** a closing delimiter exists; without one, the file has no frontmatter and the parser does not swallow the whole note.

This list is longer than a card parser looks like it needs. The reason is that a false positive here does not merely produce a junk card — sync writes a stamp into the line, so a false positive **edits the user's note**. See [ADR 0002](../decisions/0002-one-line-card-syntax.md).

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
