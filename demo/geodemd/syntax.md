---
title: GeodeMD card syntax
tags: [tools, reference]
note :: frontmatter is skipped, so this line is not a card
---

# GeodeMD card syntax

Notes on the tool I keep my notes in. Deliberately includes the awkward cases,
because this is exactly the file where they turn up in real life.

## The rule

A card is one line with ` :: ` in it. Whitespace on both sides is required.

Which separator makes a line a card :: a double colon with whitespace on both sides

The spaces are what keep ordinary writing out of it. `foo::bar` is not a card,
and neither is a `key::value` field, which is why config snippets survive.

Is `foo::bar` a card :: no — the separator needs whitespace around it

## What gets skipped

Six shapes are never read as cards, and this section contains five of them on
purpose.

Fenced code blocks:

```sh
# none of this is a card
geode sync --dry-run
alias g :: geode   # not a card either
```

Indented code blocks, the older style:

    timeout :: 3
    memory :: 512

Inline code spans, which is how you write *about* the syntax without creating
a card: use `foo :: bar` to declare one.

Tables:

| flag | meaning |
|---|---|
| `--dry-run` | writes nothing :: reports what it would do |
| `--full` | ignores the mtime cache |

> Blockquotes too :: so quoting someone who uses the separator is safe

### Headings :: are skipped as well

The list is longer than a card parser looks like it needs. The reason is that
a false positive does not just make a junk card — it writes a stamp into your
note.

Why is the skip list so long :: because a false positive edits your note, not just your queue

## Things that still work

A card can hold a `::` in its answer, because only the first separator counts.

How is the separator split :: on the first ` :: ` only — a later one is answer text

List markers and task boxes are stripped from the question:

- Where is the review log kept :: in `.sr/log/` inside your notes directory
* What is the database :: a cache, rebuildable from the notes and the log
1. What does `geode rebuild` do :: drops every table and reconstructs it
- [ ] What happens to a card whose note you delete :: it leaves the queue, but its history stays in the log
- [x] Does a stamp show up in rendered Markdown :: no — it is an HTML comment

A trailing comment that is not a stamp is stripped from the answer:

What is the deferral window :: two seconds <!-- TODO check this against the code -->
