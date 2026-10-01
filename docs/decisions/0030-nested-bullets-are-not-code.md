# 0030 — A bullet nested under another bullet is not code

- **Status:** Accepted
- **Date:** 2026-10-01
- **Amends:** [ADR 0002](0002-one-line-card-syntax.md)'s indented-code skip, which treated any line starting with four spaces or a tab as code

## Context

The parser skipped every line indented four spaces or a tab as an indented code block. That was one line-level predicate, and it kept the likeliest false positive in a technical note out: a tab-indented shell snippet containing ` :: `.

It also skipped every bullet nested three or more levels deep, because by then the bullet is indented four columns:

```
- Cell
  - Nucleus :: holds DNA
    - Nucleolus :: makes ribosomes
```

Only `Nucleus` was a card. Nothing said so, and outline-style notes, the way RemNote is written, are mostly deep nesting ([#60](https://github.com/T1Fleming/GeodeMd/issues/60)). Showing a card's parents above it ([#61](https://github.com/T1Fleming/GeodeMd/issues/61)) is worth little until cards deep in an outline are cards at all.

## Decision

**Indentation is measured from the list item a line sits in, the way Markdown measures it.** The parser keeps the column at which each open list item's text starts. A line is indented code when it is four or more columns past the innermost one, or past the margin outside a list. Tabs advance to the next multiple of four columns.

**A line four or more columns from the margin is read only if it opens a list item:** a bullet or number marker, optionally with a task box, as already stripped from questions. Indented text that is not a bullet stays skipped, as before.

**When the parser cannot tell, the line is not a card.** The rule follows CommonMark wherever CommonMark says "list item" and is stricter everywhere else:

- **A lazy continuation line closes the list.** Text at the margin directly under a bullet continues that bullet in CommonMark. Here it ends the list, so a deep bullet after it is skipped.
- **A horizontal rule (`* * *`, `- - -`) opens nothing**, though it starts with a marker.
- **A heading, paragraph or fence at the margin closes every open item.** Blank lines between items do not.

So every line that was a card before is still a card. The only lines that become cards are bullets that Markdown itself renders as nested list items.

### Rejected: any bullet inside a list

The simpler rule reads every marker line that follows a list item as a card, however deep. It catches sloppy indentation. It also reads this as a card and stamps it:

```
- Haskell example

      - f :: Int
```

Markdown renders the last line as a code block inside the item, because it is six columns past the item's text at column 2. A false positive writes into the user's note, so the rule that agrees with how the note renders wins.

## Consequences

- **An existing vault gains cards on its next sync:** the bullets that were skipped become new cards and are stamped. The first-sync preview shows them as it shows any new card. This is the point of the change, and it is why it is recorded here rather than made quietly.
- `parse` now carries one piece of state across lines, the open list items, beside the fence and frontmatter state it already had. It is still pure text in, cards out.
- `parseLine`, which reads one line without its block context, is unchanged.
