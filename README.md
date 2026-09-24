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

## Try it

[`demo/`](./demo/) is a small collection of notes that looks like notes someone keeps — 23 cards across four files, including one that deliberately contains the awkward cases. Copy it before syncing, since a sync writes a stamp into every card line:

```sh
cp -r demo ~/geode-demo
```

Then point the app at `~/geode-demo` on first launch. It counts what it found, shows you the settings before writing them, and makes the real sync unreachable until you have previewed it.

## Install

GeodeMD is one application — a desktop app. There is no command line ([ADR 0025](docs/decisions/0025-the-app-is-the-only-interface.md) records why the CLI was removed, and what that cost).

**It is not signed yet**, so there is no download: you build it. That needs an Apple Developer account to fix ([#38](https://github.com/T1Fleming/GeodeMd/issues/38)), and [`docs/design/releasing.md`](docs/design/releasing.md) says what to set when there is one.

```sh
git clone https://github.com/T1Fleming/GeodeMd.git
cd GeodeMd
npm install
npm install --prefix desktop     # Electron, and better-sqlite3 rebuilt for its ABI
npm run build:desktop
npm --prefix desktop start
```

To make a `.dmg` instead of running it from source:

```sh
npm --prefix desktop run package   # desktop/release/*.dmg
```

Gatekeeper will refuse an unsigned build until you right-click → Open.

**On the two installs.** `better-sqlite3` is a native module compiled against one ABI, and Electron ships its own Node — so the root install builds it for your Node (which is what the test suite runs against) and `desktop/postinstall` rebuilds it for Electron's. `.nvmrc` pins the Node this is developed against. If you hit `NODE_MODULE_VERSION` errors, that mismatch is what they are. See [`desktop/README.md`](desktop/README.md).

The app carries its own documentation: the guides and the configuration reference are bundled and rendered in its Help tab, so an installed copy is self-contained ([ADR 0020](docs/decisions/0020-ship-the-docs-inside-the-app.md)).

## Quick start

**1. Point it at your notes.** The first launch walks it: choose the folder, see how many Markdown files are in it, confirm that your notes will be edited, preview the sync, then run it.

That writes `~/Library/Application Support/GeodeMD/config.json` on macOS (`~/.config/geodemd/config.json` elsewhere) — `notesPath`, `device`, `dbPath`, and an optional `editor` you can add later. The database goes to `~/.local/share/geodemd/db.sqlite` — outside your notes, deliberately, because it is a cache and a live database file is the worst thing to put under a sync or backup tool.

**2. Look before it writes.** The **Preview** button, and it is the step worth not skipping — [the guide walks through it](./docs/guides/first-sync.md). **The first real sync stamps every line in your notes that parses as a card**, which on an existing collection is a diff across the whole tree. A preview writes nothing — not a stamp, not a database row — and tells you exactly how many files and cards it would touch. Read the number and check it against what you expect. If your notes already use `::` somewhere unexpected, this is where you find out, cheaply.

If your notes are in version control, commit them first. The app asks you to confirm that you have.

**3. Write cards.** Anywhere in any note, on one line:

```markdown
Default Lambda timeout :: 3 seconds
- Max memory :: 10240 MB
- [ ] Cold start cause :: a new execution environment
```

The separator needs whitespace on both sides, so `foo::bar` is not a card. **Sync after editing** — that's the contract. Reviewing deliberately does not walk your notes, so that a session stays fast no matter how large the collection is.

**4. Review.** The Review tab. Any key reveals the answer — except `q`, which quits there and then without recording anything. Once the answer is showing: `1` again · `2` hard · `3` good · `4` easy. Before it is showing, `0` defers the card without recording anything at all. Each card shows its source line — `algorithms/Sorting.md:142` — and `o` opens that note at that line in your editor. If any note you opened changed while you were reviewing, the end of the session says so, because the queue holds the text from your last sync.

A card rated anything but `easy` is usually due again within ten minutes, so it comes back before the session ends and the counter's total grows to match — [the reviewing guide](./docs/guides/reviewing.md) covers that, and which rating to press when.

Your editor is `editor` in the config file if you set it, then `$VISUAL`, then `$EDITOR`, and failing all three whatever your OS opens a `.md` with:

```json
{ "notesPath": "/Users/you/notes", "device": "mac-k3f9", "dbPath": "...", "editor": "code" }
```

It jumps to the line for the editors that can be told to (`vim +142`, `code --goto file:142`, `hx file:142`, and so on) and opens the file plainly for the ones that can't. Set a **GUI** editor: the app launches it and carries on rather than waiting, so a terminal editor would open somewhere you cannot type into it.

## The four screens

| | |
|---|---|
| **Review** | The session. Keys as above; every rating is written to the log and flushed before anything else happens. |
| **Sync** | Preview, sync, and `full` — which re-reads every file, ignoring the mtime cache. Rebuild lives here too, behind a confirmation: it drops the database and derives it again from your notes and logs. |
| **Collection** | Total, due now, due before local midnight, new. |
| **Help** | The guides and the configuration reference, bundled into the app. |

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

The first two are durable and are what you back up. The database is **fully derivable**: delete it, hit **Rebuild**, and it comes back identical. There is no column in it that does not come from your notes or your logs, and the test suite asserts that by comparing every table after a rebuild.

Practical consequence: delete a note and its cards leave the queue, but their history does not go anywhere. Restore the note a year later and the cards come back on their original schedule.

Guides: [reviewing](./docs/guides/reviewing.md) · [when something looks wrong](./docs/guides/recovery.md) · [moving your notes between machines](./docs/guides/moving-notes.md).

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

The test suite covers the five places [`docs/design/testing.md`](./docs/design/testing.md) identifies as expensive to get wrong — the parser, sync, incremental sync, prune, and rebuild — plus a scale harness that asserts ratios and counts rather than wall-clock ceilings, and a suite that enforces the module boundaries so that `core` importing the interface, SQL outside `store/`, or a clock in `parser/` fail the build. `npm test` also regenerates [`docs/design/behaviours.md`](./docs/design/behaviours.md), which is every behaviour the suite checks, by area.

```
src/parser/     pure: text -> cards. No filesystem, no database, no clock.
src/files/      the only module that touches the filesystem, log included
src/store/      the only module that touches SQLite
src/scheduler/  FSRS, with its parameters pinned in source
src/core/       sync, getDueCards, reviewCard, rebuild — the public API
src/host/       this machine: paths, config, the review keys, the queue
src/electron/   the app: main process, IPC contract, renderer
src/journeys/   one test file per guide, holding it to what it claims
```

[`docs/design/`](./docs/design/) describes how each piece works now — the parser, the data model, the sync algorithm, the review flow. [`docs/decisions/`](./docs/decisions/) records *why* each choice is what it is, next to the alternative it beat, which is the reasoning behind things that look odd until you know what they prevent.

## Status

**Single-machine, one interface, and not yet installable.** The app does everything — first run, sync, rebuild, review, stats, its own documentation — and is complete enough to use daily, which is how it is used. What it is not is *distributable*: the build is unsigned, so anyone but you meets Gatekeeper ([#38](https://github.com/T1Fleming/GeodeMd/issues/38)). That is the next thing that matters.

There was a CLI, and it was removed rather than deprecated ([ADR 0025](./docs/decisions/0025-the-app-is-the-only-interface.md)): nobody reviews flashcards in a terminal, and the app had grown to cover every command. The cost was real and is recorded there — no git hooks, no cron, nothing over ssh. The module boundaries above are what made removing an interface cost nothing below the interface line, and what would make adding one back a renderer-sized job.

Cross-device sync is a possible phase after signing; the append-only log layout deliberately does not foreclose it, but nothing here is built for it yet. Reviewing on a phone is the larger gap, and nothing here addresses it.
