# A demo collection

Four notes that look like notes someone actually keeps, holding **23 cards**.
Read them to see what GeodeMD expects, or copy the folder and review it.

```
aws/lambda.md        cards among prose, where most of them live in practice
sqlite/wal.md        the same, on another topic
geodemd/syntax.md    the awkward cases — code blocks, tables, frontmatter
archive/old-notes.md a note with no cards at all
```

## Copy it before you sync it

```sh
cp -r demo ~/geode-demo
```

**Copy rather than syncing in place.** A sync writes a stamp into every card
line — that is how a card keeps its identity when you move it — and running it
inside this repository would leave you with two dozen modified files you did
not mean to change. [The first-sync guide](../docs/guides/first-sync.md)
explains what that does on a real collection.

## What the files are for

`aws/lambda.md` and `sqlite/wal.md` are the ordinary case: cards written on one
line, in among prose, in the place the thought came up. Nothing marks a card
out except the separator — there is no card block, no mode, and no editor
plugin.

`geodemd/syntax.md` is a note *about* the tool, which makes it the natural
place for the difficult cases. It contains a fenced code block, an indented
one, an inline code span, a table, a blockquote, a heading and YAML
frontmatter — **each containing ` :: `, and none of them a card**. That is not
contrived: a note explaining a syntax is exactly where you would write about
the syntax, and it is the file most likely to break a parser that is too eager.

`archive/old-notes.md` has no cards. A sync reads it, finds nothing, and moves
on — and once its mtime is recorded, later syncs do not open it at all.

## It is checked, not just written

`src/demo.test.ts` parses this folder and asserts what it yields: the card
count per file, that the skipped shapes produce nothing, and that list markers
and trailing comments are stripped as claimed.

So a parser change that would break this collection fails the suite rather
than quietly making the documentation wrong. The test only reads — it never
writes a stamp.
