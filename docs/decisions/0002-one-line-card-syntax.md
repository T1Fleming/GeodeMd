# 0002 — One-line `::` card syntax with a strict skip list

- **Status:** Accepted
- **Date:** 2026-09-19 (backfilled)
- **Source:** plan.md §3

## Context

Authoring a card had to cost nothing: no mode switch, no separate file, no manual ID, and no syntax that only one editor understands. Whatever shape a card takes, it has to survive being read by a human in a plain renderer and by another tool later.

## Decision

Exactly one form is recognised in phase 1: a single line containing ` :: `. Everything before the **first** separator is the question, everything after it is the answer.

The separator requires whitespace on both sides, so `foo::bar` in code or in a `key::value` field is not a card. A leading list marker or task box is stripped from the question, because `- Default Lambda timeout :: 3 seconds` is how people actually write these.

Six contexts are never read as cards: fenced code blocks, indented code blocks, a separator inside an inline code span, table rows, YAML frontmatter, and lines beginning with `>` or `#`.

`::` was chosen because it is the closest thing to a convention across existing SR tooling, so cards written this way stay machine-readable if this program is abandoned.

## Consequences

- The skip list is longer than a card parser looks like it needs, and that is deliberate: **a false positive does not merely produce a junk card, it writes a stamp into the user's note.** The write path goes to unusual lengths not to damage a file, and an under-specified input filter undoes every bit of that.
- Each skip rule is one line-level predicate, cheap to evaluate and cheap to test. None of them is worth trading for a corrupted code block.
- Cloze deletions, multiline cards and reversed cards are out of scope. A `type` column exists in the schema so a future taxonomy has somewhere to land without a migration, but nothing branches on it.
- One line is always at most one card. A second ` :: ` is ordinary answer text.
