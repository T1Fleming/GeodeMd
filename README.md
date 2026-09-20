<p align="center">
  <img src="./assets/banner.svg" alt="Geode — spaced repetition over an ordinary directory of Markdown files" width="900">
</p>

# GeodeMD

A spaced repetition system where **everything durable is plain text in an ordinary directory of Markdown files**. Notes hold card content, append-only JSONL logs hold review history, and a SQLite database outside that directory holds nothing but a rebuildable cache.

Write a card by typing one line in any note:

```markdown
Default Lambda timeout :: 3 seconds
```

Sync stamps it with an ID in an HTML comment — invisible in every Markdown renderer — and the card keeps the context it was written in: the reviewer shows you `aws/Lambda.md:142`. No editor-specific syntax anywhere. If this program disappears, the directory is still an ordinary folder of Markdown files.

---

## Install

Requires Node 20 or newer. `better-sqlite3` is a native module, so the Node version you build with is the one you must run with — the repo pins it in `.nvmrc`.

```sh
git clone https://github.com/T1Fleming/GeodeMd.git
cd GeodeMd
npm install
npm run build
npm link          # puts `geode` on your PATH
```

`npm link` points the installed binary at this working copy: edit `src/`, run `npm run build`, and `geode` changes immediately. If you'd rather not have that, run it as `node /path/to/GeodeMd/dist/cli/index.js` instead.

## Quick start

**1. Point it at your notes.**

```sh
geode init ~/notes
```

That writes `~/.config/geodemd/config.json` — `notesPath`, `device`, `dbPath`, and an optional `editor` you can add later. The database goes to `~/.local/share/geodemd/db.sqlite` — outside your notes, deliberately, because it is a cache and a live database file is the worst thing to put under a sync or backup tool.

**2. Look before it writes.**

```sh
geode sync --dry-run
```

This is the step worth not skipping. **The first real sync stamps every line in your notes that parses as a card**, which on an existing collection is a diff across the whole tree. `--dry-run` writes nothing — not a stamp, not a database row — and tells you exactly how many files and cards it would touch. Read the number and check it against what you expect. If your notes already use `::` somewhere unexpected, this is where you find out, cheaply.

If your notes are in version control, commit them first.

**3. Sync for real.**

```sh
geode sync
```

**4. Write cards.** Anywhere in any note, on one line:

```markdown
Default Lambda timeout :: 3 seconds
- Max memory :: 10240 MB
- [ ] Cold start cause :: a new execution environment
```

The separator needs whitespace on both sides, so `foo::bar` is not a card. Run `geode sync` after editing — that's the contract. `review` deliberately does not walk your notes, so that a review session stays fast no matter how large the collection is.

**5. Review.**

```sh
geode review          # 50 cards
geode review -n 200   # a bigger session
geode stats
```

Any key reveals the answer — except `q`, which quits there and then without recording anything. Once the answer is showing: `1` again · `2` hard · `3` good · `4` easy, and `q` to stop. Each card shows its source line — `algorithms/Sorting.md:142` — and `o` opens that note at that line in your editor and drops you back on the same card when you close it. If any note you opened changed during the session, the last line says so, because the queue is holding the text from your last `geode sync`.

Your editor is `editor` in the config file if you set it, then `$VISUAL`, then `$EDITOR`, and failing all three whatever your OS opens a `.md` with:

```json
{ "notesPath": "/Users/you/notes", "device": "mac-k3f9", "dbPath": "...", "editor": "nvim" }
```

It jumps to the line for the editors that can be told to (`vim +142`, `code --goto file:142`, `hx file:142`, and so on) and opens the file plainly for the ones that can't.

## Commands

| | |
|---|---|
| `geode init <path> [--force]` | Write the config file. Refuses to overwrite without `--force`, and keeps your `device` name either way. |
| `geode sync [--full] [--dry-run]` | Walk the notes, stamp new cards, ingest the logs. `--dry-run` writes nothing; `--full` re-reads every file, ignoring the mtime cache. |
| `geode review [-n N]` | The review loop. Needs an interactive terminal. Default 50 cards. `o` opens the card's note in your editor. |
| `geode stats` | Total, due now, due before local midnight, new. |
| `geode rebuild` | Drop the database and rebuild it from your notes and logs. |

Exit codes: `0` success — including a run that skipped an unreadable file, which is reported in the summary rather than treated as failure; `1` a configuration or usage error; `2` an unexpected error.

## What it does to your notes

Exactly one thing: it appends a stamp to lines that are cards.

```markdown
Default Lambda timeout :: 3 seconds <!-- sr-a7Kd9mQ2xR4v -->
```

That's an HTML comment, so it is invisible in every Markdown renderer — GitHub, Obsidian, VS Code preview, pandoc, any static site generator. The ID is how a card is identified, so moving or renaming a file never loses its scheduling.

Nothing else in your notes is touched. A file with CRLF line endings keeps them; a file with no trailing newline keeps that too. Cards are not read from fenced or indented code blocks, inline code spans, tables, YAML frontmatter, blockquotes or headings.

## Where your data lives

| | |
|---|---|
| **Cards** | in your notes, as the lines you wrote |
| **Review history** | `<notes>/.sr/log/<device>-YYYY-MM.jsonl` — append-only, one line per review |
| **Everything else** | `~/.local/share/geodemd/db.sqlite` — a cache |

The first two are durable and are what you back up. The database is **fully derivable**: delete it, run `geode rebuild`, and it comes back identical. There is no column in it that does not come from your notes or your logs, and the test suite asserts that by comparing every table after a rebuild.

Practical consequence: delete a note and its cards leave the queue, but their history does not go anywhere. Restore the note a year later and the cards come back on their original schedule.

## Scale

Built for up to roughly a million cards across a million files of mixed sizes. A sync costs what *changed*, not what exists — a sync that finds nothing changed reads no file and writes no database row at all. That property is asserted by the test suite rather than assumed, because it is the kind of thing that regresses silently.

Enumeration is the cost that grows with the collection, because a deletion leaves no trace and the only way to notice one is to look. Measured on a 20,000-file tree, it runs at 4.4 µs per file in flat directories and 9.5 µs in a vault of small topic folders; the stats are issued through a bounded concurrent pool rather than one at a time. A **cold** cache costs 1.09× warm — barely more, on an SSD — which settled the question of whether this stays a plain walk.

These are measurements rather than extrapolations, on local APFS; [`docs/design/sync.md`](./docs/design/sync.md#measurements) has the method and the limits.

## Development

```sh
npm test          # the whole suite, about a second
npm run test:watch
npm run typecheck
npm run build
```

The test suite covers the five places [`docs/design/testing.md`](./docs/design/testing.md) identifies as expensive to get wrong — the parser, sync, incremental sync, prune, and rebuild — plus a scale harness that asserts ratios and counts rather than wall-clock ceilings, and a suite that enforces the module boundaries so that `core` importing `cli`, SQL outside `store/`, or a clock in `parser/` fail the build.

```
src/parser/     pure: text -> cards. No filesystem, no database, no clock.
src/files/      the only module that touches the filesystem, log included
src/store/      the only module that touches SQLite
src/scheduler/  FSRS, with its parameters pinned in source
src/core/       sync, getDueCards, reviewCard, rebuild — the public API
src/cli/        argv, config, review loop
```

[`docs/design/`](./docs/design/) describes how each piece works now — the parser, the data model, the sync algorithm, the review flow. [`docs/decisions/`](./docs/decisions/) records *why* each choice is what it is, next to the alternative it beat, which is the reasoning behind things that look odd until you know what they prevent.

## Status

The single-machine CLI is complete. An Electron app is planned **alongside it, not instead of it** — the two are peer interfaces over the same core, and the CLI stays because it composes with scripts and because a terminal review loop is the fast path when you are already in a terminal. The module boundaries above are what let one core serve both. Cross-device sync is a possible phase after that; the append-only log layout deliberately does not foreclose it, but nothing here is built for it yet.
