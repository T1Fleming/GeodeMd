# Your first sync on an existing collection

If your notes already exist — a vault you have been writing in for years, a folder of technical notes, anything — the first real sync **edits every file that contains a card**. This guide is how to see what that means before it happens.

If you are starting from an empty folder, none of this applies. Write a card, sync, carry on.

To rehearse it on something harmless, copy [`demo/`](../../demo/) and point GeodeMD at that — it is a real collection with 23 cards and the same stakes at a smaller scale.

**The app walks you through all of this on first launch** — it counts the Markdown files in the folder you pick, shows you the settings before writing them, asks you to acknowledge that your notes will be edited, and makes the real sync unreachable until you have run a preview. This guide is what those steps mean, and is worth reading anyway: the app can show you the numbers, but only you know whether they are the ones you expected.

## What the first sync does

GeodeMD identifies a card by an ID it writes into the line, as an HTML comment:

```markdown
Default Lambda timeout :: 3 seconds <!-- sr-a7Kd9mQ2xR4v -->
```

Invisible in every Markdown renderer — GitHub, Obsidian, VS Code preview, pandoc — but **it is a change to the file**. Every line in your notes that parses as a card gets one, the first time you sync.

On a collection with a few hundred cards spread over a hundred notes, that is a hundred modified files in one command.

## Look before it writes

The **Preview** button, on the last step of first-run setup and on the Sync screen afterwards.

A preview writes nothing — not a stamp, not a database row — and reports exactly what the real run would do:

```
dry run — nothing was written
412 files (0 unchanged, 412 read), 1893 cards found, 1893 new, 0 updated, 96 files stamped — 240ms
```

Two numbers matter, and they are different questions:

- **`1893 cards found`** — lines GeodeMD read as cards.
- **`96 files stamped`** — notes it would edit. This is the diff size.

**Read both against what you expect.** If you thought you had a few dozen cards and it found nineteen hundred, something in your notes uses ` :: ` for a purpose you had forgotten about — and the dry run is where you find that out, rather than in a diff afterwards.

## What counts as a card

One line containing ` :: `, with whitespace on both sides:

```markdown
Default Lambda timeout :: 3 seconds
- Max memory :: 10240 MB
- [ ] Cold start cause :: a new execution environment
```

`foo::bar` is **not** a card — the spaces are required, which is what keeps `key::value` fields and most code out of it.

Deliberately skipped: fenced and indented code blocks, inline code spans (`` `foo :: bar` `` is prose *about* a syntax), table rows, YAML frontmatter, blockquotes, and headings.

That list is longer than it looks like it needs to be, for exactly the reason this guide exists: a line wrongly read as a card does not just create a junk card, **it edits your note**.

## If the number is wrong

Nothing has been written yet, so you have options:

- **Move the notes you do not want synced** out of the directory, or into a dotted folder — anything under a `.` directory is skipped entirely.
- **Point GeodeMD at a subdirectory** instead — `~/notes/flashcards` rather than `~/notes`.
- **Change the lines**, if a handful of notes use ` :: ` for something else.

## Commit first

If your notes are in git, commit before the real sync. Not because GeodeMD is likely to get it wrong, but because a hundred-file diff is much easier to inspect — and undo — when it is the only thing in your working tree.

If they are not in version control, take a copy of the folder.

## Then run it

**Sync**, on the Sync screen.

The counts should match the dry run. Now check one file:

```sh
git diff --stat          # if you use git
```

Every changed line should differ only by a trailing `<!-- sr-... -->`. Nothing else in your notes is touched: a file with CRLF line endings keeps them, a file with no trailing newline keeps that too.

## What happens afterwards

Sync again after you edit notes — that is the contract. Reviewing deliberately does not walk your notes, so a review session stays fast no matter how large the collection gets, which means it shows you the text from your last sync.

From here the first sync never repeats. Later syncs only read what changed, and a sync that finds nothing changed writes nothing at all.

## If your notes move later

Nothing breaks. The app notices on launch that the folder it was pointed at is gone — a moved directory, an external drive that is not plugged in — and offers to repoint it rather than treating you as a new user. Your device name and editor setting are kept, which matters more than it sounds: regenerating the device name would start a second review log and split this machine's history across two files.

Pointing the app at a new folder does the same, and preserves the same two fields for the same reason: **Change folder…** at the bottom of the Collection screen. It walks the same steps as the first run, including the preview, and you can cancel at any point without changing anything. To start a fresh collection, make a new folder from the picker itself; your existing cards stay where they are, with their history.

## See also

- [When something looks wrong](recovery.md) — the database is a cache, and rebuilding it is safe
- [Config file keys](../reference/configuration.md)
