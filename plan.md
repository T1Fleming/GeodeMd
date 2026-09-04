# GeodeMD — Phase 1 Design Spec

A spaced repetition system where **everything durable is plain text in an ordinary directory of Markdown files** — notes hold card content, append-only JSONL logs hold review history — and a SQLite database outside that directory holds nothing but a rebuildable cache.

This document is a build brief. Phase 1 is a CLI. A later phase is an Electron app. The structure below exists so that later phase is an interface swap, not a rewrite.

The project is **GeodeMD**; the command you type is `geode`, kept short deliberately. Its directories are `~/.config/geodemd/` and `~/.local/share/geodemd/`.

---

## 1. Goals and non-goals

**Goals**

- Author a flashcard by typing one line inside any note, with no mode switch and no manual ID.
- Preserve the context a card was written in — every card resolves to a file and a line.
- Notes stay readable and portable. Nothing written into a note is visible in rendered Markdown, and no syntax is specific to one editor. If this program disappears, the directory is still an ordinary folder of Markdown files.
- Review from the terminal.
- **Stay correct and responsive from a hundred cards to a million.** This is a first-class constraint, not an aspiration: it decides the ID length, the sync algorithm, the log layout, and three indexes. Wherever a simpler design would have been adequate at personal scale, the spec says so and says what replaced it.

  The target is up to roughly **a million cards across up to a million files, of mixed sizes** — one-concept-per-file notes and long topic notes in the same tree. The mix is free: nothing in the design cares how many cards a file holds. What it does care about is **file count**, because a full walk is the only way to notice a deletion, and no cache removes that. Section 8 opens with the measured cost of that walk — 1.7 s at a million files, warm — and with the seam that replaces it if the number ever stops being acceptable. Those two axes, cards and files, are separate everywhere in this spec; when a decision is driven by one of them it says which.
- Module boundaries that let an Electron UI call the same core later.

**Non-goals for phase 1** — do not build these, do not add abstractions in anticipation of them:

- Cloze deletions, multiline cards, reversed cards
- Decks, tags, filtering, per-deck config
- Anki export/sync
- Any resident daemon or live/reactive behaviour. Snapshot-based change detection that runs on demand is not this, and section 8 step 1 pre-authorizes it
- GUI of any kind
- FSRS parameter optimization on user history
- Undo, media, audio, images
- Multiple note directories
- Sync of any kind — phase 1 is one machine
- Plugin system, hooks, extension points
- Any dependency on a specific Markdown editor's conventions

---

## 2. Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript, Node 20+ | Same language as the eventual Electron app; core library ships forward unchanged |
| Scheduler | `ts-fsrs`, pinned to an exact version | Maintained, FSRS-6, no algorithm work needed. Pinned rather than `^`-ranged because its default parameters are part of the library, and section 7 depends on them not moving |
| Database | `better-sqlite3` | Synchronous API keeps phase 1 code linear and readable, and its prepared-statement + transaction API is what makes a million-row sync finish in seconds rather than hours |
| CLI | Hand-rolled `process.argv` switch | Five commands and three flags do not justify a dependency, and it keeps `cli/` as thin as section 6 demands |
| IDs | `nanoid` | Short, URL-safe, no ambient state |
| Tests | `vitest` | Fast, zero-config |

Single package. No monorepo, no workspaces. Directory layout is the expandability mechanism, not tooling.

Build and run: `tsc` to `dist/`, a `bin` entry pointing at `dist/cli/index.js` behind a `#!/usr/bin/env node` shebang, and `npm link` for daily use. `vitest` runs the TypeScript directly, so the test loop has no build step in it. Pin the Node version in `.nvmrc` and use it — `better-sqlite3` is a native module compiled against one Node ABI, and the first symptom of an unpinned version is a `NODE_MODULE_VERSION` mismatch on the tool you reach for every day.

---

## 2a. Configuration and paths

One JSON file, three keys, read in exactly one place:

```
~/.config/geodemd/config.json     { "notesPath": "...", "device": "mac-k3f9", "dbPath": "..." }
~/.local/share/geodemd/db.sqlite  default DB location, overridable
```

XDG paths on every platform, macOS included. One less branch, and two string constants instead of an afternoon with `env-paths`.

`cli` reads the file, applies `--notes` as an override, and passes one plain object into `core`. `core` never reads the filesystem for config and never touches `process.env` (section 6, rule 3). `device` defaults to slugified `os.hostname()` plus a short random suffix, fixed once at `init` — section 5a explains what the suffix protects; `dbPath` defaults as above. `geode init <notesPath>` writes the file, so first run is not "hand-author some JSON".

`init` prints two lines of advice before exiting: commit the notes directory first if it is under version control, then run `geode sync --dry-run`. The first real sync stamps every file holding a card, and that is much better learned from a dry run than from a diff.

`init` **refuses to overwrite an existing config unless `--force`, and preserves `device` even then.** It should be re-runnable to fix a `notesPath` typo without that doubling as a way to change the machine's identity: regenerating `device` silently starts a second log file and scatters one machine's history across two names. Nothing is lost when that happens — ingest reads every `.jsonl` — but nothing is gained either. Only a config with no `device` mints one.

**"The notes directory"** means the root passed to `init`, and every path stored anywhere is relative to it. Nothing in this design cares what created the Markdown inside it.

---

## 3. Card syntax

Phase 1 recognizes exactly one form: a single line containing ` :: `.

```markdown
Default Lambda timeout :: 3 seconds
```

Everything before the **first** separator is the question, everything after it is the answer. Both are trimmed.

After the first sync, the ingester appends a stamp:

```markdown
Default Lambda timeout :: 3 seconds <!-- sr-a7Kd9mQ2xR4v -->
```

Rules:

- The separator must have whitespace on both sides, so `foo::bar` in code or in a `key::value` field is not a card.
- Split on the first ` :: ` only. A later ` :: ` is ordinary answer text and is not a second card — one line is always at most one card.
- Strip a leading list marker (`-`, `*`, `+`, `N.`, and a `[ ]` / `[x]` task box) and any leading whitespace from the question before splitting. `- Default Lambda timeout :: 3 seconds` is how people actually write these, and the marker must not end up on the front of the flashcard.
- Strip **any** trailing HTML comments from the answer before storing it, not just the stamp. A line ending `... 3 seconds <!-- TODO check -->` is a card whose answer is `3 seconds`.
- Both sides must be non-empty after trimming, or the line is not a card.
- A line already ending in a stamp keeps that ID; never re-mint. **Only `<!-- sr-[A-Za-z0-9]{12} -->` at end of line is a stamp** — see section 4.

**Skipped contexts.** Six shapes the parser must never read as a card:

- Lines inside **fenced** code blocks.
- Lines inside **indented** code blocks — a run of lines indented four spaces or one tab. Fencing is not the only way Markdown marks code, and a tab-indented shell snippet containing ` :: ` is the likeliest false positive in a technical note tree.
- Lines where the separator falls inside an **inline code span** — an odd number of backticks precedes it. `` Use `foo :: bar` to declare it `` is prose *about* a syntax, not a card in it.
- Lines beginning with `|` — **table rows**. `| Timeout :: 3s | note |` would otherwise become a card with a pipe on the front of its question and a pipe on the end of its answer.
- Lines inside **YAML frontmatter** — between an opening `---` on line 1 and the next `---`. If there is no closing delimiter, the file has no frontmatter; do not swallow the whole note.
- Lines beginning with `>` (blockquote) or `#` (heading).

That list is longer than a card parser looks like it needs, and the reason is section 8 step 4: a false positive here does not merely produce a junk card, it **writes a stamp into the user's note**. The write path already goes to unusual lengths not to damage a file — the re-stat guard, the terminator-preserving split — and an under-specified input filter undoes every bit of that. Each rule above is one line-level predicate. None of them is worth trading for a corrupted code block.

`::` is chosen because it is the closest thing to a convention across existing SR tooling and the Anki bridges. Cards written this way remain machine-readable by other tools if this program is abandoned.

---

## 4. Identity

**Key on the ID alone. Never on file path, never on line number.**

The ID is minted by the ingester and written back into the note. Because the ID is globally unique, moving or renaming a file does not orphan its cards — the sync pass finds the ID at a new path and updates the path column. File path is a mutable attribute, not part of the key.

Mint `sr-` followed by **12** nanoid characters drawn from `[A-Za-z0-9]`. That whole string — `sr-a7Kd9mQ2xR4v` — is the card's ID everywhere: `cards.id`, the `card` field in the log, the locator.

**Twelve, not eight, and the difference is the whole scale target.** Eight characters is 62⁸ ≈ 2.2 × 10¹⁴, which sounds like plenty until you put a million cards through it: the birthday bound gives a collision probability of roughly 2 × 10⁻³ — about one collection in 436. That is not a rounding error, and it is not benign either, because a collision does not fail loudly. Two cards sharing an ID look exactly like the copy case below, so one of them is silently re-minted and its history is left stranded against an ID nothing points to any more. Twelve characters is 62¹² ≈ 3.2 × 10²¹ and the same calculation gives 1.6 × 10⁻¹⁰. At that number, "do not build collision handling" is a defensible instruction rather than an optimistic one.

**The stamp is an HTML comment, and that is a deliberate change from an editor-specific anchor.** An HTML comment is invisible in every Markdown renderer — GitHub, VS Code preview, pandoc, any static site generator — which is what the portability goal in section 1 actually asks for. A bare `^token` anchor is invisible in exactly one editor and renders as visible debris everywhere else. The comment costs about ten characters per stamped line and buys a stamp that no reader ever sees.

It also removes an ambiguity that a bare token could not: an HTML comment is unmistakable, so no amount of ordinary answer text can be misread as a stamp, and a line that happens to end with some *other* comment is harmless — the parser strips trailing comments from the answer and appends its own after them. Both stay invisible.

Minted collisions are negligible, but **copied** IDs are not — duplicating a stamped line is how people write a similar card. Two occurrences of one ID are resolved as follows, and the resolution has to distinguish a copy from a move, because at scale the sync pass does not re-read the file the ID came from:

- **Two occurrences in the same file.** The first in line order keeps the ID. Later ones are treated as unstamped, get a fresh ID, and are stamped.
- **An ID that arrives at a new path.** The stored row says file A, the ID was just parsed in file B. Read file A — one file, and only on a genuine path change. If the ID is no longer there, or A no longer exists, this is a **move**: update the row's path. If the ID is still in A, this is a **copy**: the occurrence in B is the duplicate, gets a fresh ID, and is stamped.

**Re-minting replaces the existing stamp; it never appends a second one.** The natural implementation reuses the step 5 stamp writer, which appends, and produces `<!-- sr-old --> <!-- sr-new -->`. Write the replacement path explicitly.

Because a card resolves to a path and a line, the reviewer surfaces `algorithms/Sorting.md:142` under each card, which every editor and terminal can open. That is the context mechanism. It is a display convenience built from `cards.file_path` and `cards.line_no`, and nothing may key on it — see section 6.

---

## 5. Data model

Five tables. Check every column against one property: nothing here exists that is not derivable from the notes directory and the logs.

```sql
-- Regenerable from the notes directory. Delete freely.
CREATE TABLE cards (
  id         TEXT PRIMARY KEY,
  file_path  TEXT NOT NULL,   -- relative to notesPath
  line_no    INTEGER,         -- 1-based; display convenience, refreshed each
                              -- sync; the stamp write uses ParsedCard.lineIndex
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'basic',
  reviewed   INTEGER NOT NULL DEFAULT 0  -- 1 iff a card_state row exists.
                                         -- Denormalized on purpose; see below.
);

CREATE INDEX idx_cards_path ON cards(file_path, line_no);
-- The new-card queue, as an index rather than a scan. See section 9.
CREATE INDEX idx_cards_new  ON cards(file_path, line_no) WHERE reviewed = 0;

-- The incremental-sync cache: what the walk saw last time.
CREATE TABLE files (
  path      TEXT PRIMARY KEY,  -- relative to notesPath
  mtime_ms  INTEGER NOT NULL,
  size      INTEGER NOT NULL
);

-- An INDEX over the JSONL logs in section 5a. Rebuilt, not authoritative.
-- Still never UPDATE or DELETE rows here; it mirrors an append-only source.
-- No foreign key on card_id: reviews outlive the cards they refer to.
-- WITHOUT ROWID: rows live inside the primary-key B-tree. See below.
CREATE TABLE reviews (
  card_id  TEXT NOT NULL,     -- may have no row in `cards`; see below
  rated_at TEXT NOT NULL,     -- ISO-8601 UTC, ms precision; see 5a
  rating   INTEGER NOT NULL,  -- 1..4, FSRS Rating
  PRIMARY KEY (card_id, rated_at)   -- a review is the same review whatever
                                    -- file it arrived in; see 5a
) WITHOUT ROWID;

-- How far each log file has been ingested. Purely a read cursor.
CREATE TABLE log_files (
  name    TEXT PRIMARY KEY,   -- file name within .sr/log/
  size    INTEGER NOT NULL,   -- size at the last ingest
  offset  INTEGER NOT NULL    -- byte offset of the end of the last COMPLETE line
);

-- Regenerable by replaying `reviews` through the scheduler.
CREATE TABLE card_state (
  card_id     TEXT PRIMARY KEY,
  due         TEXT NOT NULL,
  stability   REAL,
  difficulty  REAL,
  reps        INTEGER NOT NULL DEFAULT 0,
  lapses      INTEGER NOT NULL DEFAULT 0,
  state       INTEGER NOT NULL,   -- ts-fsrs State enum
  last_review TEXT
);

CREATE INDEX idx_state_due ON card_state(due);
```

`type` is a single column defaulted to `'basic'`. It is not a feature in phase 1 — it exists so a future card taxonomy has somewhere to land without a migration. Do not branch on it anywhere.

**`reviews` holds three columns and no rowid, and both halves of that are deliberate.**

The log line carries `device`, `elapsed` and `scheduled`; the table does not. Section 5a says no code path reads them back and designates the log as the future optimizer's input, so mirroring them into SQLite buys nothing and costs storage and page-cache pressure on the one structure that is read constantly. Dropping them makes the schema agree with a decision section 5a had already made.

What remains is a table whose every access is "the rows for this card, in `rated_at` order" — so `(card_id, rated_at)` is the natural primary key, and `WITHOUT ROWID` stores the rows inside that B-tree instead of beside it. Roughly half the storage, one tree to maintain rather than two, dedupe and ordering are the key itself, and a card's history is a contiguous range scan with no row lookups.

It also deletes a hazard rather than documenting one. An earlier draft carried an autoincrement `id` and a paragraph warning that it reflects *ingest* order and must never order a replay — a real trap, because a log arriving three days late inserts older reviews after newer ones. There is now no such column, so the mistake is unrepresentable. Prefer that to a warning wherever the choice exists.

**`files` and `log_files` are the price of the scale target**, and both are still caches: one records what the filesystem looked like, the other records how far a file has been read. Note what `files` does *not* carry: any per-pass "seen" marker. Section 8 step 6 explains why — marking a million rows on every sync costs more than the walk that produced them. Neither holds a fact that is not on disk. Delete them and the next sync re-reads everything and arrives at the same place, slowly.

**`cards.reviewed` is a deliberate denormalization**, and the one place this schema stores the same fact twice. It exists because section 9 needs the first fifty *never-reviewed* cards in path order, and the honest query for that is an anti-join against `card_state` — which, in a collection where 900,000 of a million cards have been reviewed, walks 900,000 index rows probing a primary key each time before it finds fifty. With `reviewed` it is a partial index and the answer is O(log n) regardless of collection size. Maintain it in the same transaction that writes `card_state`, and **set it on insert from `EXISTS(SELECT 1 FROM card_state WHERE card_id = ?)`** — a restored card has state and must not re-enter the queue as new. Section 10's rebuild test compares full tables, which is what catches it if it ever drifts.

**The entire database is derivable.** Not merely disposable — derivable, with no residue: `cards` and `files` are a function of the notes directory, `reviews` and `log_files` are a function of the logs below, `card_state` is a function of replaying `reviews`. No column anywhere in the schema exists only here. Put the DB outside the notes directory, at the path section 2a names — never inside it. The notes and the logs are the durable plain-text half of this design and the DB is neither half of it; a live database file is the single worst thing to place under any sync or backup tool, and it drags its `-wal` and `-shm` siblings along with it.

Open it with `journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout` of a few seconds, and a `cache_size` of a few tens of MB. WAL and the busy timeout let a `sync` started while a `review` session is open block briefly instead of failing. `synchronous = NORMAL` is safe under WAL and is what keeps a bulk sync from fsyncing per statement — the durability that matters lives in the log, which fsyncs explicitly (section 5a), so the database can afford to be the fast half.

**Every write path runs inside a transaction with prepared statements.** At a million cards this is not a micro-optimization: an autocommit-per-statement sync is the difference between seconds and hours. Batch the walk into transactions of a few thousand upserts so a crash mid-sync loses a bounded amount of progress rather than all of it.

`rebuild` drops every table, then runs a full `sync` — steps 1 through 8, stamp writes included, so a card authored while the DB was gone still gets its ID. It is a normal sync against an empty database, not a separate code path, which is the only reason it can be trusted to stay working. Because nothing in the schema is non-derivable, it recovers the database *completely*: there is no set of columns a rebuild silently zeroes, which is why section 10 can assert equality with no carve-outs.

At the top of the scale range `rebuild` is minutes, not milliseconds — a full walk, a full parse, and a replay of every review ever recorded. Write it in the first session and run it after every schema change, but stop thinking of it as something to run casually. It is the recovery path, and the incremental sync in section 8 is the daily one.

**One escape hatch is pre-authorized, together with the test that makes it safe.** The ingest half of a rebuild inserts every review ever recorded into a single B-tree, and if that turns out to dominate the operation, the remedy is the standard one: stage the rows in an unindexed table and insert them in `(card_id, rated_at)` order, or build the key after the load. Every version of that is a second code path, which is exactly what the paragraph above forbids.

So the rule is relaxed precisely this far: **`rebuild` may use a bulk load for step 7, and if it does, a test asserts that a bulk rebuild and an incremental rebuild produce identical tables.** That test is what the shared-path rule was buying, bought a different way. Do not build the bulk path speculatively — measure first, and if the number is fine this paragraph costs nothing. It exists so that the day the number is not fine, the safe version is already specified rather than invented under pressure.

An earlier draft tracked absence: a `created_at`, a `missing_since` written when a card was not found in a pass, a `deleted_at` tombstone written after seven days, and two sync steps maintaining them. They are gone. The reasoning is worth recording, because the property they appear to protect sounds like it needs them.

That property is **absence is not deletion** — delete a note, restore it from a backup a year later, and its scheduling comes back intact. It survives their removal untouched, because those columns were never what carried it. It is carried by the paragraph below: `reviews` is keyed on card ID alone and is never filtered by what `cards` holds, so a card's history outlives every row that refers to it. Dropping a card row when its file goes missing loses nothing, and the next sync that finds the file re-inserts the row — with `reviewed` set from the state that was still there — and the card returns to the queue on its original schedule.

What the tombstone machinery bought *on top of* that was one narrower thing: a card whose file was temporarily gone stayed in the queue for up to seven days. That behaviour is real and it is now gone. It is not worth three columns, two sync steps, a grace period, a rule about tombstones being reversible, and a permanent asterisk on the claim that the database is derivable.

New-card ordering loses `created_at` along with them, and loses nothing by it. Section 9 orders new cards by `(file_path, line_no)`, which is what the old tiebreak was already doing all the work: every never-reviewed card shared one `created_at` after any rebuild, so ordering on it alone degenerated to whatever SQLite happened to return.

**Reviews outlive cards.** A log may hold reviews for an ID that is no longer anywhere in the notes directory. Never filter the log by what `cards` currently contains: ingest those rows, and skip `card_state` for IDs with no card. The log is authoritative and the card index is not. This is the mechanism every paragraph above rests on.

---

## 5a. The review log

The one thing that cannot be reconstructed from anywhere else is the history of what was rated when. It lives in the notes directory as plain text, **one append-only JSONL file per device per month**:

```
<notes>/.sr/log/mac-k3f9-2026-09.jsonl
<notes>/.sr/log/mac-k3f9-2026-10.jsonl
<notes>/.sr/log/laptop-p7w2-2026-10.jsonl
```

One line per review:

```json
{"card":"sr-a7Kd9mQ2xR4v","at":"2026-09-02T18:41:07.324Z","rating":3,"elapsed":12.1,"scheduled":21.4}
```

Two things are being kept separate in that filename, and both matter.

**Per device, because the invariant is one writer per file.** An append-only file promised never to be rewritten should never need *renaming* either, so naming it after the machine that writes it costs nothing now and makes a second machine additive rather than a migration.

**Per month, because of the scale target.** A million cards reviewed even ten times each is ten million lines and roughly a gigabyte. As one file that is a single object every backup must re-transfer whole and every ingest must seek into; as monthly shards it is a few dozen files of which exactly one is ever open for writing and all the others are frozen forever. A frozen shard whose recorded size matches its size on disk is skipped by ingest without being opened at all, which is what keeps `geode review` fast in year three. Sharding costs one date component in a filename and changes nothing else: the true log is still the concatenation of every file in the directory, ordered by `at`.

Rules:

- Append only. Never rewrite, never compact, never sort in place. The month boundary is decided by the `at` being written, so a review at 23:59:59.998 on the last of the month and one at 00:00:00.002 land in different files and nothing has to be moved.
- `at` is **always** ISO-8601 UTC with exactly three fractional digits and a trailing `Z`: `2026-09-02T18:41:07.324Z`. Pin this in the first session. The merged log is ordered by `at`, and fixed-width UTC ISO-8601 sorts lexicographically, so ordering is free in both SQL and JS — but mixing precisions silently breaks it, since `Z` (0x5A) sorts after `.` (0x2E) and a second-precision line therefore lands after every millisecond-precision line in the same second. The log is append-only and never rewritten, so a format change later leaves the directory permanently holding both shapes.
- Millisecond precision is also what stops the `(card_id, rated_at)` primary key from silently swallowing a genuine second review of the same card within one clock tick.
- `elapsed` and `scheduled` are recorded for future FSRS parameter optimization and for debugging. **No code path reads them back.** Replay is a pure function of (card ID, `at`-ordered ratings), which is what makes rebuild deterministic by construction rather than by coincidence. Both are **omitted** on a card's first review — there is no previous review to measure from, and writing `0` would be a fabrication the future optimizer reads as fact — so readers must treat both fields as optional. They live in the log and **nowhere else** — section 5 does not mirror them into SQLite, because a column no code path reads is pure cost in a table that reaches eight figures of rows.
- The device name comes from config, defaulting to `os.hostname()` slugified plus a short random suffix fixed at `geode init`. Two machines both called `macbook-pro` would otherwise share a filename and break the one-writer-per-file invariant the layout rests on.
- **`device` is descriptive, never part of a review's identity.** It names the file and appears in each line; it is not stored in SQLite either. Uniqueness is `(card_id, rated_at)`. When a duplicated line does land in the log directory, it is recognized as a review already held rather than as a second device's history — which would otherwise replay every affected card with its reviews counted twice, producing silently wrong stability and difficulty on top of a log that is itself uncorrupted.
- Ingest reads **every** `.jsonl` in the log directory, whatever it is named. A restored backup, a file copied by hand, or a file forked by whatever moves the directory between machines is harmless, because `(card_id, rated_at)` makes re-ingest a no-op. Skipping an unfamiliar file can only lose data — it may be the only place some reviews exist — while reading it costs nothing.
- `reviewCard` appends to the log **first**, then updates SQLite. If the process dies between the two, the next ingest picks the line up and the DB catches up. The reverse order loses data.
- Append with `O_APPEND`, write each review as a single `write()`, and `fsync` the descriptor before touching SQLite. `fsync`, not merely a flushed userspace buffer — the difference is surviving a power loss rather than only a killed process, and this is a loop paced by a human pressing keys, so the cost is irrelevant. `O_APPEND` with one-line writes far under `PIPE_BUF` is also what makes two concurrent processes interleave whole lines instead of splitting one; it is why no lock file is needed.
- Ingest is idempotent via the `(card_id, rated_at)` primary key, so re-reading a whole file is always safe. That is what makes the `log_files` cursor an optimization rather than a correctness dependency: delete the table and the next ingest re-reads every shard and reaches the same state.
- A `.sr/log/` directory that does not exist yet is created on first write; an absent log directory is a first run, not an error.
- A line that fails to parse is skipped and counted, never fatal. The expected malformed line is a truncated final line from a crash mid-append — exactly the crash that the log-write-first ordering exists to survive, so aborting the ingest on it would defeat the rule that motivated the design.
- `.sr/` is a dotted directory and is therefore already excluded from enumeration (section 8 step 1), so log files are never mistaken for notes.

This is the durability boundary. Notes hold content, `.sr/log/` holds history, both are plain text in the notes directory, both survive this program being abandoned. Everything else is a cache.

---

## 6. Module layout

```
src/
  parser/     markdown text -> ParsedCard[]     PURE. No fs, no db.
  files/      file walking, reading, stamp writes,  ONLY module that touches fs
              log append and log reads
  store/      SQLite queries                        ONLY module that touches sqlite
  scheduler/  thin wrapper over ts-fsrs             swappable behind an interface
  core/       sync(), getDueCards(), reviewCard()   orchestration; the public API
  cli/        argv parsing, terminal I/O            phase 1 interface; thin
  index.ts    re-exports core
```

Three types cross those boundaries, so they are pinned here rather than left to inference:

```ts
interface ParsedCard {
  id: string | null;   // null until minted
  question: string;
  answer: string;
  lineIndex: number;   // 0-based; authoritative for the stamp write
}

// The card_state row of section 5, minus card_id.
interface CardState {
  due: string; stability: number; difficulty: number;
  reps: number; lapses: number; state: number; last_review: string | null;
}

interface DueCard {
  id: string;
  question: string;
  answer: string;
  locator: string;     // "algorithms/Sorting.md:142" — relative to notesPath
}
```

The review log is a file, so `files/` owns it: appending a line and reading the `.sr/log/` directory both live there, not in `store/`. It is easy to file the log under `store/` because it holds review history, but that would put `fsync` and `O_APPEND` in the module whose only job is SQLite and break the one-module-per-resource rule that makes the Electron phase cheap.

`ParsedCard.lineIndex` is authoritative — it is what section 8 step 4 writes the stamp against. `cards.line_no` is a display convenience refreshed on each sync, and nothing may key on it. They are two different things and only one of them is safe to build on. `DueCard.locator` is built from `line_no` and is display only, which is why a card that moved since the last sync shows a stale line rather than failing.

**Hard rules, because these are what make the Electron phase cheap:**

1. `core` never imports `cli`. The dependency runs one way.
2. `core` functions return data. They never `console.log`, never `process.exit`, never prompt.
3. No top-level side effects in any module. Config is passed into `core`, never read from `process.env` inside it — and the same applies to the two other ambient dependencies. `now: () => Date` and `newId: () => string` live in that config object, defaulted in `cli` to the real clock and `nanoid`. Without them section 10's tests cannot be written at all: asserting that stamping is idempotent needs predictable IDs, and asserting that a card comes due needs to fast-forward past its interval.
4. `parser` takes a string and returns objects. It never opens a file. This is what makes it testable and what lets a future editor plugin reuse it.
5. Long operations take an optional `onProgress` callback rather than printing. At the top of the scale range a `sync` runs for seconds and a `rebuild` for minutes, so this stops being a nicety — `cli` renders a counter from it.

If those five hold, the Electron app is `core` plus a renderer. If they don't, it's a rewrite.

---

## 7. Scheduler interface

Define this even though there is one implementation. It is four lines and it is the one abstraction worth having up front.

```ts
export interface Scheduler {
  /** State for a card that has never been reviewed. */
  initial(now: Date): CardState;
  /** Next state given current state and a rating. */
  next(state: CardState, rating: 1 | 2 | 3 | 4, now: Date): CardState;
}
```

`FsrsScheduler` implements it by delegating to `ts-fsrs`. Parameter *optimization* is out of scope — the shipped defaults are fine until there are thousands of reviews — but the parameters themselves are **pinned in the source, never inherited from the library**:

```ts
// Frozen. Section 10's rebuild test asserts that replaying a log reproduces
// card_state exactly, which holds only if the scheduler is a pure function of
// (history, params). Do not move these to config. Do not let them default.
export const FSRS_PARAMS = generatorParameters({
  w: [/* the full default weight vector, written out literally */],
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
});
```

Two hazards are being closed, and only one of them is obvious.

`enable_fuzz` randomizes each interval by a few percent. With it on, a rebuild produces a different `due` than the run it rebuilt, and section 10's rebuild test fails intermittently — the worst way for a test to fail, because the first few red runs read as flakiness rather than as a broken invariant. Confirm the library's current default rather than assuming it: the point of writing the value down is that the default is not yours to rely on.

Which is the second hazard, and the quieter one. FSRS's default weights are a fitted model that the library revises. A `ts-fsrs` minor bump can therefore change what a rebuild produces from an unchanged log — the notes stay durable while the schedule derived from them silently does not. Writing the vector out literally, and pinning the dependency to an exact version (section 2), makes that a change you make on purpose.

---

## 8. Sync algorithm

```ts
sync(now: Date, opts?: { full?: boolean; dryRun?: boolean }): SyncSummary
```

A batch operation. It runs on demand and holds no resident process. Like the two functions in section 9 it takes `now` explicitly rather than reading the clock (section 6, rule 3).

**The organizing idea is that a sync costs what *changed*, not what exists** — and at the file counts section 1 targets, that has two halves. Reading only the changed files is the obvious half. The half that is easy to miss is that a sync which finds nothing changed must also **write** nothing: a million rows of bookkeeping costs more than the walk that produced them.

`dryRun` writes nothing — not a stamp, not a row — and returns the summary the real run would have produced. It is not a debugging aid. **The first sync of an existing collection rewrites every file that contains a card**, because every card is unstamped; at the top of section 1's target that is a diff across the whole tree and, if the notes are in version control, a commit larger than everything before it. `init` should say so and point at `--dry-run`. It is also what lets the stamp writer be exercised end to end before it is ever aimed at real notes.

Measured on a 50,000-file tree, warm cache, extrapolated linearly:

| Files | `stat` only | `stat` + read + parse |
|---|---|---|
| 100k | 0.17 s | 3.8 s |
| 1M | 1.7 s | 38 s |

That 22× is what step 2 buys, and it is why a plain walk is still adequate at a million files. Those numbers are **warm**; a cold cache is plausibly an order of magnitude worse, and section 10 measures both rather than assuming one.

1. **Enumerate candidates** — produce `(path, mtime, size)` for every `.md` file. Phase 1 walks the tree recursively, sorting directory entries so the order is deterministic across machines and filesystems. Skip:
   - any dotted directory — which covers `.git/`, `.sr/`, and whatever an editor leaves behind, without naming any of them
   - non-`.md` files
   - **directory symlinks**. Do not follow them, and count them. Whether a walk follows a symlink is otherwise decided by an implementation accident — recursing on `dirent.isDirectory()` does not, recursing on `statSync().isDirectory()` does — and the consequence is not cosmetic. A followed symlink presents one file at two paths; the second visit sees every ID as already-seen, re-mints all of them, and writes back through the link to the same file. The card's identity then churns on every sync, stranding its history in the log each time. Tracking inodes to de-duplicate instead is the more "correct" answer and is not worth it: it buys support for a layout the user can also get by moving the folder in.

   **This step is a seam, and it is the only part of the design that knows how changes are discovered.** Everything downstream consumes a list. A full walk is one implementation; `@parcel/watcher`'s `writeSnapshot` / `getEventsSince` is another, and on macOS it answers from FSEvents' kernel-cached history rather than touching the tree at all — no daemon, no resident process, still entirely on demand, which is why it does not violate the non-goal in section 1. That is the swap to make if a cold walk ever becomes intolerable. Do not build it speculatively: the table above says a warm walk at a million files costs under two seconds, and a second native module carries the same ABI-pinning cost as `better-sqlite3`.

2. **Classify** each candidate against `files` — one indexed read, no write:
   - **row exists and `(mtime_ms, size)` both match**, and `--full` was not passed → **unchanged**. Skip it without opening it.
   - **row exists and they differ** → changed.
   - **no row** → new.

   Select `rowid` along with `mtime_ms` and `size` — it costs nothing extra and step 6 needs it. As you go, count `hits` (candidates that had a `files` row) and set that row's bit in an in-memory bitmap indexed by rowid. At a million files the bitmap is 125 KB.

   The `(mtime, size)` comparison is a heuristic, and where it is wrong it is silently wrong: a tool that rewrites a file while preserving its mtime leaves stale cards in the database forever. That is what `--full` is for — it forces every candidate through steps 3–5 — and it is why `--full` is a documented flag rather than a debugging aid.

3. **Read and parse** each changed or new file. Collect `ParsedCard[]`. Within the file, an ID seen twice is resolved by section 4: the first in line order keeps it.

4. **Defer, mint, write.** If the file's mtime is within 2 seconds *of the stat in step 2* — not of the sync's start, which at this scale may be minutes earlier — mark it **deferred**: reconcile the cards in it that already carry IDs, and mint nothing. It is likely open in an editor.

   Otherwise mint IDs for the unstamped lines and apply all stamps for the file in **one write**, reconstructing the file from its lines. Split so that **each line keeps its own terminator** — `/(?<=\r?\n)/` — and rejoin by concatenation, never by `join("\n")`. A CRLF file, or one with no trailing newline, must come back byte-identical apart from the stamped lines; splitting on `\n` silently converts a whole note the first time one card in it is stamped, which shows up as a full-file diff in git and a full re-transfer in whatever moves the directory, and works against "notes stay readable and portable". Immediately before writing, stat the file again and skip the write if **`(mtime, size)`** differs from step 2 — the deferral guard does not cover a file edited in the milliseconds *after* it was read, and the failure mode is silently reverting the user's keystrokes. Compare size as well as mtime because mtime granularity is one second on some filesystems, so two edits inside the same tick are indistinguishable by mtime alone — and this is a write path that destroys the user's typing when it guesses wrong.

   After a successful write, re-stat and record the *new* `(mtime, size)` in step 5. Recording the pre-write values would make the file look changed on the next sync, forever.

5. **Reconcile the file's cards.** Upsert into `cards`, **only for cards whose ID is now on disk and was written or confirmed this pass.** Nothing minted but unwritten may enter the DB — and neither does a card treated as unstamped at step 3 that received no written ID, which is the duplicate-inside-a-deferred-file case: its ID *is* on disk, but it belongs to the first occurrence, so upserting it would overwrite that card's row with the copy's path and text. Skip it entirely; it is picked up once the file goes quiet.

   An ID whose stored row names a *different* path triggers the move-versus-copy check in section 4 — read that one file and decide. This is the only place the sync reads a file it did not walk to, and it happens only on a genuine path change.

   If the parsed question or answer differs from the stored row, update them but **leave `card_state` untouched** — a typo fix must not reset scheduling. Automatic reset on edit is explicitly not wanted.

   Then delete this file's vanished cards: `DELETE FROM cards WHERE file_path = ? AND id NOT IN (<ids parsed from it>)`. Scoping the delete by path is what makes it safe against ordering — a card that moved from this file to another already had its row's path updated, so it is no longer matched here, whichever order the two files were walked in.

   Finally, upsert the `files` row with the recorded `(mtime_ms, size)`.

6. **Prune — and usually decide not to.** Each candidate is enumerated once, so `hits` is exactly how many rows of `files` were found on disk. Compare it with `known`, the row count of `files` **taken before the walk began**, so that files inserted during this pass cannot skew it:

   - **`hits == known`** — every known file is still there. Nothing was deleted or renamed, so there is nothing to prune. Stop. A sync that found no changes has now written **nothing at all**.
   - **`hits < known`** — `known - hits` files vanished. Scan `files` by rowid once; every row whose bit is unset is a path that is no longer on disk. Delete their `cards` rows and then their `files` rows. One sequential scan, no second enumeration, no temporary table.

   The bitmap is what makes that cheap, and it is worth seeing what it replaced. An earlier draft stamped every row with a generation counter on every pass — a million indexed writes and tens of megabytes of WAL traffic **for a sync that found nothing**, more expensive than the walk it was bookkeeping for. The draft after that kept the count check but reconciled by walking a second time and staging every path into a temporary table, which removed the cost from the common case and put it straight back on any sync where a file was renamed. The bitmap has neither problem: 125 KB of memory, no writes when nothing vanished, and one sequential scan when something did.

   `reviews` and `card_state` are never touched here, which is exactly what makes the delete safe: a pruned card loses a row, not a history.

   One consequence is an improvement worth naming. A file that **failed to read** was still enumerated and still has a `files` row, so it counts as a hit and is *not* pruned — its cards keep their last known text until a later sync reads it successfully. Under the generation scheme it would have been treated as absent and pruned. Counting what was *seen* rather than what was *read* is the more forgiving of the two, and it is the one you want on a path whose failure mode is "your cards vanished".

7. **Ingest logs, incrementally.** For each `.jsonl` in `<notes>/.sr/log/`, `stat` it and compare against its `log_files` row:
   - recorded `offset == size` on disk → nothing new; **do not open the file**. This is what makes a directory of frozen monthly shards free to skip.
   - `size < offset` → the file shrank, so it was truncated or replaced. Reset the offset to 0 and read it whole; `INSERT OR IGNORE` makes that harmless.
   - otherwise read from `offset` to EOF.

   Parse each complete line and `INSERT OR IGNORE` into `reviews`. **Advance the stored offset to the end of the last line terminated by a newline, never to EOF.** A truncated final line from a crash mid-append will be completed by the next append, and an offset past it would skip the completed line forever — which is precisely the crash the log-write-first ordering exists to survive.

   Collect the card IDs where a row *actually inserted*, and **replay exactly that set**. Two rules govern the replay and they are easy to confuse with each other:

   - **Which cards to replay is decided by what inserted — never by comparing timestamps.** Arriving late and being late are different things: a machine offline for three days produces reviews that are all *older* than what has already been folded in, so a "newer than `last_review`" test skips them and their history stays in the durable log but permanently absent from scheduling.
   - **How to replay a given card is a free choice, because the scheduler is a pure fold.** If every newly-inserted review for that card is strictly newer than its `card_state.last_review`, fold them onto the existing state. Otherwise replay the card's full history from zero. The first case is the common one on a single machine and turns an O(history) operation into an O(new) one; the second is exact and always available.

   Read history **`ORDER BY rated_at`** — chronological replay is the correctness condition the whole log design rests on, and it is a range scan rather than a sort because it is the table's primary key. Upsert `card_state`, skip IDs with no card row, and set `cards.reviewed = 1` in the same transaction.

   The two strategies are one computation written twice, which is a real risk of drift — and section 10's rebuild test already covers it with nothing added. That test builds state incrementally (fold-forward), then rebuilds from an empty database (from-scratch), and asserts the tables are identical. It has been a differential test between these two paths all along.

Steps 4–5 hold one invariant: **an ID exists in the DB only if it exists on disk.** Mint, write, then upsert — never mint, skip the write, and upsert anyway. The wrong order means a card authored while its file is open in an editor gets an ID and a row, loses the stamp, is re-minted on the next pass as a second card, and the first row is then pruned. Every card written into an open file would grow a ghost twin that survives exactly one sync. The cost of the correct order is that such a card waits for the next sync, which is what the deferral guard was buying anyway.

Step 6 is the one that looks reckless and is not. **Absence is not deletion** — but what makes that true is step 7's table, not step 6's. `reviews` is keyed on card ID and never filtered by `cards`, so deleting a card row discards an index entry and no history: a branch switch takes cards out of the queue, and switching back puts them in, fully scheduled and not re-queued as new, because the insert reads `reviewed` back from `card_state`. Never hard-delete from `reviews` or `card_state`. That is where the line is, and `cards` is on the other side of it.

**Step 7 never writes to the notes directory; steps 1–6 do.** It does write to SQLite — that is its job — but it opens no note and mints no ID, and that is the property which lets `review` and `stats` run it implicitly (section 9) with no risk of touching the user's files.

On one machine step 7 is what lets the DB catch up. `reviewCard` writes the log before SQLite, so a crash between the two leaves a review in the log and not the database, and the next ingest folds it in; it is also the ingest half of `rebuild`. It is *additionally* the whole of multi-device support the day a transport exists — new lines arrive, fold into local state, no merge logic and no conflict resolution.

Clock skew is the one thing this ordering cannot survive. A device with a badly wrong clock mis-orders its reviews permanently, and no rebuild repairs it. Accept it: the fix is a vector clock, and section 11's last paragraph is about resisting exactly that.

Two failures are handled differently on purpose. A `notesPath` that is missing or is not a directory is a **configuration error**: fail loudly and exit non-zero, because every count the run would report is meaningless and a silent zero-card sync looks like success — and because a `notesPath` pointing at an empty directory would otherwise prune the entire collection in step 7. An individual file that cannot be read or parsed is **skipped and counted**, never fatal — one bad file must not stop the other twenty thousand, and the summary is where the user finds out. The same asymmetry governs the log: a missing log directory is a first run, a single unreadable line is a skip.

**Exit codes.** `0` on success — *including* a run that skipped unreadable files, because a skip is a reported outcome and not a failure; making it non-zero would break every script the first time one note has bad permissions. `1` for a configuration or usage error: no config, a `notesPath` that is missing or not a directory, `review` without a TTY. `2` for an unexpected internal error. The summary is where partial failure is communicated, not the exit status.

**Two concurrent syncs are safe by construction, and must not acquire a lock.** The `(mtime, size)` re-stat immediately before each write means the second process skips whatever the first already wrote, and WAL plus the busy timeout serializes SQLite. This is a property the design already has; it is written down so that nobody adds a lock file to fix a problem that does not exist.

Return a summary object: files enumerated, files unchanged, files read, files deferred, cards found, new, updated, pruned, whether the reconciliation pass ran at all, duplicate IDs re-minted, symlinked directories skipped, log shards skipped, log bytes read, reviews ingested, files skipped on error, log lines skipped — plus wall-clock time, which at this scale is a number the user actually wants.

**The shape of a no-op sync, stated plainly.** When nothing has changed, a sync is: one `stat` per file, one indexed read per file, one `COUNT(*)`, one `stat` per log shard. **No writes, anywhere.** That is the property to protect — it is what the count check in step 6 exists for, and it is what section 10's harness asserts. Everything else in this section is the handling of change, which by definition is proportional to how much changed.

The remaining cost is the enumeration itself, and it is linear in file count with no cache that can remove it, because absence is the only signal a deletion leaves. At the top of section 1's target that is 1.7 s warm — acceptable — and an unmeasured multiple of that cold, which is the one number that could still change the design. Step 1 is a seam precisely so that changing it is a module swap rather than a restructure.

---

## 9. Review flow

```ts
getDueCards(now: Date, limit?: number): DueCard[]
reviewCard(cardId: string, rating: 1|2|3|4, now: Date): void
```

`getDueCards` runs two indexed queries and concatenates them, taking `limit` in total. Neither may sort the collection.

```sql
-- Due, most overdue first. Uses idx_state_due.
SELECT c.id, c.question, c.answer, c.file_path, c.line_no
  FROM card_state s JOIN cards c ON c.id = s.card_id
 WHERE s.due <= :now
 ORDER BY s.due
 LIMIT :n;

-- New, in the order they read in the notes. Uses the partial idx_cards_new.
SELECT id, question, answer, file_path, line_no
  FROM cards
 WHERE reviewed = 0
 ORDER BY file_path, line_no
 LIMIT :remaining;
```

The second query is why `cards.reviewed` exists. Written as an anti-join against `card_state` it is correct and it degrades linearly with the number of *reviewed* cards, which is the number that grows; against the partial index it is a range scan of exactly `:remaining` rows whatever the collection holds.

Ordering is deterministic and testable; no randomization in phase 1. No burying, no sibling logic, no daily limits.

There is no filter for absent cards, because a card row is deleted as soon as a sync does not find its line. Note the precise scope of that: **pruning happens in `sync`, and `review` does not run one.** A note deleted after the last sync leaves its cards in the queue until the next `sync` — the old seven-day grace period, replaced by an interval the user controls rather than one the spec picked.

That is a decision, not an oversight. Making `review` walk the tree first would charge every session a full walk — tolerable at twenty thousand files, not at a hundred thousand — to avoid being asked about a card you deleted. `sync` after editing is the contract.

`limit` defaults to 50 and the CLI exposes `--limit` (short form `-n`). A months-long gap produces a queue in the thousands, and the point of surviving that gap is undermined by a session that cannot be ended; print `50 of 1240 due`. That total is a separate `COUNT(*)` against the same index, not the length of a fetched list — at a million cards the count is the cheap part and materializing the queue would not be. There is deliberately no *persistent* daily-limit state — that would be durable state living outside the two places section 5a declares durable.

One consequence is worth knowing before it surprises you: due cards are served ahead of new ones, so a backlog larger than `limit` starves new cards completely until it clears. That is the intended trade — recovering what you already half-know beats piling on more — and the escape hatch is a larger `-n`, not a scheduling rule.

`reviewCard` appends one line to this device's current monthly log file, `fsync`s it, then inserts into `reviews`, upserts `card_state`, and sets `cards.reviewed = 1` in a transaction. **The log write comes first.** A crash between the two leaves the DB behind by one review, which the next ingest repairs; the reverse order loses the review outright.

**A busy database is not an error worth ending a session over.** WAL allows one writer, so a `reviewCard` issued while a long `sync` or `rebuild` holds the write lock will exhaust the busy timeout and fail. By then the rating is already `fsync`ed into the log — which is what the ordering above is for — so the failure is precisely the condition the next ingest repairs. Catch `SQLITE_BUSY`, print one line (`database busy; reviews are in the log and will sync later`), and keep going. This is the first place the log-first rule pays off in ordinary operation rather than after a crash, and it is the reason the busy timeout stays at a few seconds instead of being raised to cover a rebuild: blocking the user behind a minutes-long write lock is worse than proceeding.

`review` and `stats` first run section 8's **step 7 only** — ingest the logs and replay — and nothing else. On one machine it is usually a no-op, and with the `log_files` cursor it is a `stat` per shard rather than a re-read: it costs milliseconds even when the log holds ten million lines. It repairs the one-review gap left by a crash between the log write and the DB write, it keeps the ingest path exercised every session rather than only during `rebuild`, and it is the only thing a second machine would need in order to work. Step 7 writes to SQLite but opens no note; the walk and the stamp writes stay exclusive to `sync`.

CLI:

```
geode init <path>       write ~/.config/geodemd/config.json
       [--force]       overwrite an existing config; device is kept regardless
geode sync [--full] [--dry-run]
                       walk notes, stamp IDs, ingest logs, update db
                       --full     re-read every file, ignoring the mtime cache
                       --dry-run  report what would change; write nothing
geode review [-n N]     interactive loop, default 50 cards; ingests logs first
geode stats             counts: total, due now, due before local midnight, new
geode rebuild           drop all tables, then a full sync against an empty db
```

Review loop: print question → wait for any key → print answer → read `1`–`4` → record → next. `q` quits. Show the locator under each card — `algorithms/Sorting.md:142`, relative to `notesPath` — so the user can open the line in whatever editor they use.

Single keypresses mean raw mode, and three things follow from that:

- **Require a TTY.** If `process.stdin.isTTY` is false — piped input, cron, CI — exit non-zero with `review requires an interactive terminal`. A line-buffered fallback that half works is worse than a clear refusal, and there is no use for scripted review.
- **Restore the terminal on every exit path.** Put the mode restore in a `finally`, and install a `SIGINT` handler that restores it and exits 0. A process that dies in raw mode leaves echo off, which reads as a broken shell rather than as a quit — and by the log-first rule every rating already given is safe, so a clean exit is honest.
- **Print the legend**: `1 again · 2 hard · 3 good · 4 easy · q quit`, under the locator. FSRS's four ratings are not guessable from their numbers.

A card rated `1` is **not** re-shown in the same session. The queue is materialized once by `getDueCards`, and FSRS puts a lapsed card a minute or so out, so it comes back on the next `geode review`. This is a decision, not an oversight: re-queueing inside the session is learning-steps logic, which section 1 rules out.

`due` is an instant, so "due today" is ambiguous. `stats` reports **due now** as the actionable number, with *due before local midnight* as a separate forecast line.

---

## 10. Testing

Do not aim for coverage. Test the five places bugs are expensive:

- **Parser** — fixture strings in, expected cards out. Cover: fenced code blocks, **indented** code blocks, a separator inside an **inline code span**, **table rows**, **YAML frontmatter** including a file with no closing delimiter, blockquotes, headings, `foo::bar` without spaces, already-stamped lines, multiple cards per file, `::` appearing in the answer text, list-marker and task-box prefixes, an empty side, and a line ending in some *other* HTML comment — which is a card whose answer excludes the comment.
- **Sync** — against a temp directory and an in-memory SQLite. Cover: file rename preserves state, edited text preserves state, stamping is idempotent across two runs, a deferred file (fresh mtime) mints nothing and writes no `cards` row, a duplicated stamped line is re-minted rather than overwriting the original **and its stamp is replaced rather than appended to**, a duplicate inside a *deferred* file is skipped rather than overwriting the original, a card copied into a second file is re-minted while a card *moved* to a second file keeps its ID, a CRLF file with one stamped card differs from its original by exactly the stamped line, a symlinked directory is not descended into, and a missing `notesPath` exits non-zero rather than reporting a zero-card success.
- **Incremental sync** — the machinery the scale target added, and the machinery whose failures are silent. A sync that finds nothing changed writes nothing at all; `--dry-run` writes neither a stamp nor a row and still reports an accurate summary; an unchanged file is not opened on the second run; a changed file is; `--full` reads both; a deleted file triggers the reconciliation pass and an unchanged tree does not; a *renamed* file triggers it exactly once and the card keeps its ID; a file whose cards were deleted from it loses exactly those rows; a stamp write records the post-write mtime so the next run treats the file as unchanged; a log shard whose size is unchanged is not opened; a log appended to since the last run is read from the recorded offset only; a log truncated to a smaller size is re-read from zero; and **a log whose final line is truncated leaves the offset before that line, so the completed line is ingested on the following run**.
- **Prune** — the pair that replaced the tombstone machinery, and the pair that would make removing it a mistake if either failed. A deleted file removes its `cards` rows but leaves `reviews` and `card_state` untouched; restoring that file re-inserts the rows and the cards come back **due on their original schedule and not queued as new** — the assertion that `reviewed` was restored from `card_state` rather than defaulted.
- **Rebuild** — the one test that protects the durability claim. Review some cards, delete the database entirely, rebuild, assert that `cards`, `reviews`, `card_state` and `files` are **identical, in full**. No column is exempt and no row set is scoped — that total assertion is what removing `created_at`, `missing_since` and `deleted_at` bought, and it is the only version of this test that keeps proving the claim. It carries two jobs beyond the durability claim, both of them differential and both free. It catches `cards.reviewed` drifting out of agreement with `card_state`. And because the original state was built incrementally — fold-forward — while the rebuild is from-scratch, it is already the test that keeps section 8's two replay strategies agreeing; nothing extra needs writing. **If section 5's bulk-load escape hatch is ever taken, extend it the same way**: a bulk rebuild and an incremental rebuild must produce identical tables. It rests on section 7's pinned parameters: read a failure here as scheduler nondeterminism (`enable_fuzz`, a shifted default weight vector) before assuming it is an ingest bug. Also: ingesting the same log twice changes nothing, two shards merge in timestamp order regardless of read order, a review that arrives *out of order* still lands in `card_state` **and replays in `rated_at` order rather than ingest order**, a review for an ID no longer in the notes is ingested without error, and a copy of a log shard saved under a different name ingests zero new reviews.

Plus one that is not a correctness test and is not optional:

- **A scale harness — asserting shape, not seconds.** Wall-clock ceilings are machine-dependent: they pass on a laptop and fail in CI, and then someone raises the ceiling until it means nothing. Assert **ratios and counts** instead.

  The single most important assertion is not a time at all: **a sync that finds nothing changed performs zero writes.** Count statements, or diff the database file, or check SQLite's `total_changes` — any of them. That is the invariant step 6's count check exists to provide, it is the one that silently regresses the moment someone adds innocuous bookkeeping, and it holds at every scale, so it costs nothing to check on a tiny tree.

  Then the ratios. Generate a synthetic tree at two sizes — 2,000 files and 20,000, both at 50 cards per file — and assert a no-change `sync` scales roughly linearly with **file count**. Then hold file count fixed and multiply cards-per-file, and assert the no-change time stays **flat**: that one fails the moment a per-card cost re-enters a path that is supposed to be one `stat` and one indexed read per file. Do the same for `getDueCards` against a small and a large `card_state`, which must also be flat. Assert that a single-file change reads exactly one file, and that deleting a file is the only thing that triggers the reconciliation pass.

  Keep all of that small enough to run in the default suite, because a suite people stop running guards nothing.

  A separate opt-in command carries the two measurements that decide open questions rather than guard invariants, and both must record **cold and warm separately** rather than pretending there is one number: a million-file enumeration (which decides whether section 8 step 1 stays a walk or becomes a snapshot), and a million-review `rebuild` (which decides section 5's bulk-load question). Dropping the filesystem cache needs `sudo purge` on macOS, so this is a command a human runs, not something CI can fake.

That list is the whole risk surface. Everything else can be verified by using it.

---

## 10a. Build sequence

§10 says what to test; this says what to build, and in what order. One principle decides the shape:

**The only code here that can destroy the user's data is the stamp writer, so it is built and tested second — before anything interesting depends on it.** The temptation is to get cards into a database first and come back to the file writing once the design feels real. That order means the destructive path is written last, under momentum, against tests that were designed around it rather than for it.

1. **`parser/`, pure.** No filesystem, no database. Done when §10's parser fixtures are green. The skipped-contexts rules in §3 are cheapest to get right here, where a failure is a wrong object rather than a corrupted note.
2. **Enumerate and stamp — no database at all.** `sync --dry-run` first, printing what it would write; then the write itself. Terminator preservation, CRLF round-trip, the re-stat guard, the deferral window, symlinked directories. Only same-file duplicates are resolvable at this point; cross-file move-versus-copy needs stored state and waits for slice 3.
3. **SQLite: schema, classify, reconcile, count-check prune.** `sync` is now complete except for logs. Move-versus-copy lands here, and so does the bitmap.
4. **`scheduler/` + `card_state` + `getDueCards`.** The queue is queryable; every card is still new.
5. **The log — append, `fsync`, offset ingest, replay — and `rebuild` in the same slice.** Not later. §5 claims `rebuild` is trustworthy *because* it is a plain sync rather than a separate path, and that claim decays the moment it is written after everything it depends on has settled. Building it here also makes §10's rebuild test available as a differential check from the first day it can pass.
6. **The review loop.** TTY guard, rating legend, SIGINT restore, `SQLITE_BUSY` tolerance.
7. **`stats`, `init --force`, `--full`, summary rendering, `onProgress`.**
8. **The scale harness.** Last, and not optional — §10 explains why its assertions are ratios and counts rather than durations.

§10's test groups map onto slices 1, 2–3, 3, 5 and 8. That is not a coincidence and it is the useful way to read both lists: the test surface *is* the build plan, seen from the side.

---

## 11. Phase 2 sketch (do not build now)

Recorded only so phase 1 doesn't accidentally foreclose it:

- Electron shell: main process imports `core`, renderer is a review UI. No changes to `core` required if section 6's rules held.
- Cloze support: a second parser strategy; `type` column already exists.
- Anki bridge: an exporter reading `cards`, writing `.apkg`. Read-only against the store. If Anki ends up owning review history instead, the JSONL logs become a secondary record and SQLite thins to a card index — a subtraction, not a rewrite.
- FSRS parameter optimization: the logs already hold exactly what the optimizer wants, in the order it wants it.
- Snapshot-based change detection via `@parcel/watcher`, replacing the walk in section 8 step 1 — pre-authorized there rather than sketched here, because the seam already exists and the swap is one module. It is a phase 2 item only in the sense that the measured numbers do not yet require it.
- Cross-device sync — review on one machine, continue on the next. The transport is undecided: a file syncer, git, or a service the Electron app talks to. Phase 1 forecloses none of them, because the properties that make sync work are already in place — append-only logs that are never rewritten, one writer per file, `(card_id, rated_at)` as a dedupe key, fixed-width UTC timestamps, `device` recorded but never part of identity, ingest that reads the whole log directory, and replay ordered by `rated_at`. Monthly sharding helps here too: a frozen shard never changes, so a file syncer transfers each one exactly once. What a transport must **add** is conflict-copy filtering for *notes* in section 8 step 1: a duplicated note has no dedupe key, so reading one mints a second card for every line in it. Syncthing names those `*.sync-conflict-*`, Dropbox uses `(conflicted copy)` — which is exactly why the pattern belongs to the transport decision and not to phase 1.

The expandability comes from the module boundaries in section 6 and the append-only logs in section 5a. It does not come from configuration surfaces, plugin systems, or premature interfaces. Resist adding those.
