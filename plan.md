# Vault SR — Phase 1 Design Spec

A spaced repetition system where **everything durable is plain text inside the Obsidian vault** — notes hold card content, per-device JSONL logs hold review history — and a SQLite database outside the vault holds nothing but a rebuildable cache.

This document is a build brief. Phase 1 is a CLI. A later phase is an Electron app. The structure below exists so that later phase is an interface swap, not a rewrite.

---

## 1. Goals and non-goals

**Goals**

- Author a flashcard by typing one line inside any note, with no mode switch and no manual ID.
- Preserve the context a card was written in — a card is addressable as an Obsidian block reference.
- Notes stay readable and portable. If this program disappears, the vault is still a normal vault.
- Review from the terminal.
- Module boundaries that let an Electron UI call the same core later.

**Non-goals for phase 1** — do not build these, do not add abstractions in anticipation of them:

- Cloze deletions, multiline cards, reversed cards
- Decks, tags, filtering, per-deck config
- Anki export/sync
- File watching or any live/daemon behaviour
- GUI of any kind
- FSRS parameter optimization on user history
- Undo, media, audio, images
- Multi-vault support
- Plugin system, hooks, extension points

---

## 2. Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript, Node 20+ | Same language as the eventual Electron app; core library ships forward unchanged |
| Scheduler | `ts-fsrs` | Maintained, FSRS-6, no algorithm work needed |
| Database | `better-sqlite3` | Synchronous API keeps phase 1 code linear and readable |
| CLI | `commander` or hand-rolled `process.argv` switch | Trivial either way |
| IDs | `nanoid` | Short, URL-safe, matches Obsidian's block-ID charset |
| Tests | `vitest` | Fast, zero-config |

Single package. No monorepo, no workspaces. Directory layout is the expandability mechanism, not tooling.

---

## 2a. Configuration and paths

One JSON file, three keys, read in exactly one place:

```
~/.config/vault-sr/config.json     { "vaultPath": "...", "device": "mac", "dbPath": "..." }
~/.local/share/vault-sr/db.sqlite  default DB location, overridable
```

XDG paths on every platform, macOS included. One less branch, and two string constants instead of an afternoon with `env-paths`.

`cli` reads the file, applies `--vault` as an override, and passes one plain object into `core`. `core` never reads the filesystem for config and never touches `process.env` (section 6, rule 3). `device` defaults to slugified `os.hostname()`; `dbPath` defaults as above. `vault-sr init <vaultPath>` writes the file, so first run is not "hand-author some JSON".

---

## 3. Card syntax

Phase 1 recognizes exactly one form: a single line containing ` :: `.

```markdown
Default Lambda timeout :: 3 seconds
```

Everything before the **first** separator is the question, everything after it is the answer. Both are trimmed.

After the first sync, the ingester appends a block ID:

```markdown
Default Lambda timeout :: 3 seconds ^sr-a7Kd9mQ2
```

Rules:

- The separator must have whitespace on both sides, so `foo::bar` in code or a Dataview-style field is not a card.
- Split on the first ` :: ` only. A later ` :: ` is ordinary answer text and is not a second card — one line is always at most one card.
- Strip a leading list marker (`-`, `*`, `+`, `N.`, and a `[ ]` / `[x]` task box) and any leading whitespace from the question before splitting. `- Default Lambda timeout :: 3 seconds` is how people actually write these in an Obsidian vault, and the marker must not end up on the front of the flashcard.
- Both sides must be non-empty after trimming, or the line is not a card.
- Lines inside fenced code blocks are skipped.
- Lines beginning with `>` (blockquote) or `#` (heading) are skipped.
- A line already ending in `^sr-<id>` keeps that ID; never re-mint. **Only that shape is a stamp** — see section 4.

`::` is chosen because it is the de-facto convention across Obsidian SR plugins and the Anki bridges. Cards written this way remain machine-readable by other tools if this program is abandoned.

---

## 4. Identity

**Key on the ID alone. Never on file path, never on line number.**

The ID is minted by the ingester and written back into the note. Because the ID is globally unique, moving or renaming a file does not orphan its cards — the sync pass simply finds the ID at a new path and updates the path column. File path is a mutable attribute, not part of the key.

Obsidian block IDs are file-scoped and must match `[a-zA-Z0-9-]+`. Mint `sr-` followed by 8 nanoid characters drawn from `[A-Za-z0-9]`, and recognize **only** `^sr-[A-Za-z0-9]{8}$` as a stamp. That whole string — `sr-a7Kd9mQ2` — is the card's ID everywhere: `cards.id`, the `card` field in the log, the block reference. Collision risk across a personal vault is negligible; do not build collision handling.

The prefix exists because a bare `^token` is ambiguous with ordinary answer text. In any vault holding regex, shell or math notes, `Anchor for start of line :: ^abc` would otherwise parse as a card whose answer is empty and whose block ID is `abc` — and if some card had been minted `abc`, the two would collide and the rule below would fire on innocent content. The hyphen is inside Obsidian's legal charset, so the namespaced form costs nothing, and it makes this tool's own stamps identifiable in the vault, which serves the "still a normal vault" goal better than an anonymous token does.

Minted collisions are negligible, but **copied** IDs are not — duplicating a stamped line is how people write a similar card. Within a sync pass, track every ID seen; a line whose ID has already been seen is treated as unstamped, gets a fresh ID, and is stamped. The first occurrence in walk order keeps the original. This does not disturb the rename path: a moved card is one occurrence at a new path, while a copied card is two occurrences and genuinely is a new card with its own scheduling.

Because the ID is a real Obsidian block ID, `[[Some Note#^sr-a7Kd9mQ2]]` resolves natively. That is the context mechanism — the reviewer surfaces this link and the user can jump to the exact line in its surrounding note.

---

## 5. Data model

Three tables. The split matters: it encodes what is disposable and what is not.

```sql
-- Regenerable from the vault. Delete freely.
CREATE TABLE cards (
  id            TEXT PRIMARY KEY,
  file_path     TEXT NOT NULL,
  line_no       INTEGER,          -- stale display convenience, refreshed each
                                  -- sync; the stamp write uses
                                  -- ParsedCard.lineIndex. See section 6.
  question      TEXT NOT NULL,
  answer        TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'basic',
  created_at    TEXT NOT NULL,
  missing_since TEXT,             -- set when not found in a sync pass
  deleted_at    TEXT              -- tombstone; excluded from review queue
);

-- An INDEX over the JSONL logs in section 5a. Rebuilt, not authoritative.
-- Still never UPDATE or DELETE rows here; it mirrors an append-only source.
-- No foreign key on card_id: reviews outlive the cards they refer to.
CREATE TABLE reviews (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id      TEXT NOT NULL,     -- may have no row in `cards`; see below
  device       TEXT NOT NULL,     -- descriptive only; NOT part of identity
  rated_at     TEXT NOT NULL,     -- ISO-8601 UTC, ms precision; see 5a
  rating       INTEGER NOT NULL,  -- 1..4, FSRS Rating
  elapsed_days REAL,              -- write-only telemetry, never read back
  scheduled_days REAL,            -- write-only telemetry, never read back
  UNIQUE (card_id, rated_at)      -- a review is the same review whatever
                                  -- file it arrived in; see 5a
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
```

`type` is a single column defaulted to `'basic'`. It is not a feature in phase 1 — it exists so a future card taxonomy has somewhere to land without a migration. Do not branch on it anywhere.

**The entire database is disposable.** Nothing in it is authoritative: `cards` comes from the vault, `reviews` comes from the logs below, `card_state` comes from replaying `reviews`. Put the DB outside the vault, at the path section 2a names — never inside it, or Syncthing will conflict-copy a binary file and eventually corrupt it. Open it with `journal_mode = WAL` and a `busy_timeout` of a few seconds, so a `sync` started while a `review` session is open blocks briefly instead of failing.

`rebuild` is therefore load-bearing rather than a nicety: it drops every table, then runs a full `sync` — steps 1 through 8, stamp writes included, so a card authored while the DB was gone still gets its ID. It is a normal sync against an empty database, not a separate code path, which is the only reason it can be trusted to stay working. Write it in the first session and run it often enough that it stays working. It is what makes schema mistakes and a months-long neglect gap non-fatal.

Three columns cannot survive a rebuild, because they exist in neither the vault nor the logs: `created_at`, `missing_since`, `deleted_at`. The last two start empty, which is correct — a card absent from the vault does not reappear in `cards` at all, so there is nothing left to tombstone.

`created_at` is written as `now` when a card row is first created, then **lowered in step 8 for any card whose earliest review predates it**. That correction belongs to *every* sync, not to a rebuild special case: rebuild is a plain sync against an empty database, so anything rebuild needs has to be ordinary behaviour or the claim above is false. It also fixes a case that arises in normal operation — a note deleted and later restored gets a fresh `created_at` later than reviews it already has.

A never-reviewed card has no review to correct from, so every new card in the vault ends up sharing one `created_at` — which is why section 9 breaks ties on `(file_path, line_no)` instead of trusting it alone.

**Reviews outlive cards.** A log may hold reviews for an ID that is no longer anywhere in the vault. Never filter the log by what `cards` currently contains: ingest those rows, and skip `card_state` for IDs with no card. The log is authoritative and the card index is not. This buys a real property — delete a note, restore it from git a year later, and its scheduling comes back intact.

---

## 5a. The review log

The one thing that cannot be reconstructed from anywhere else is the history of what was rated when. It lives in the vault as plain text, **one append-only JSONL file per device**:

```
<vault>/.sr/log/mac.jsonl
<vault>/.sr/log/phone.jsonl
```

One line per review:

```json
{"card":"sr-a7Kd9mQ2","at":"2026-09-02T18:41:07.324Z","rating":3,"elapsed":12.1,"scheduled":21.4}
```

Why per-device files: each file is only ever appended to by one machine, so in normal operation Syncthing has nothing to merge and produces no conflict copy. It can still happen — two machines sharing a device name, a restored backup, a file copied by hand — which is why the rules below make a duplicated line *harmless* rather than assuming one never arrives. The true log is the concatenation of all files in the directory, ordered by `at`. Adding a device means adding a file; nothing else changes.

Rules:

- Append only. Never rewrite, never compact, never sort in place.
- `at` is **always** ISO-8601 UTC with exactly three fractional digits and a trailing `Z`: `2026-09-02T18:41:07.324Z`. Pin this in the first session. The merged log is ordered by `at`, and fixed-width UTC ISO-8601 sorts lexicographically, so ordering is free in both SQL and JS — but mixing precisions silently breaks it, since `Z` (0x5A) sorts after `.` (0x2E) and a second-precision line therefore lands after every millisecond-precision line in the same second. The log is append-only and never rewritten, so a format change later leaves the vault permanently holding both shapes.
- Millisecond precision is also what stops `UNIQUE (card_id, rated_at)` from silently swallowing a genuine second review of the same card within one clock tick.
- `elapsed` and `scheduled` are recorded for future FSRS parameter optimization and for debugging. **No code path reads them back.** Replay is a pure function of (card ID, `at`-ordered ratings), which is what makes rebuild deterministic by construction rather than by coincidence. Both are **omitted** on a card's first review — there is no previous review to measure from, and writing `0` would be a fabrication the future optimizer reads as fact — so readers must treat them as optional and the two columns are nullable.
- The device name comes from config, defaulting to `os.hostname()` slugified plus a short random suffix fixed at `vault-sr init`. Two machines both called `macbook-pro` would otherwise append to one filename and produce exactly the conflict copy this layout exists to avoid.
- **`device` is descriptive, never part of a review's identity.** Uniqueness is `(card_id, rated_at)`. When a conflict copy or a restored backup does land in the log directory, its lines are then recognized as reviews already held rather than as a second device's history — which would otherwise replay every affected card with its reviews counted twice, producing silently wrong stability and difficulty on top of a log that is itself uncorrupted. This is also why ingest **reads** conflict copies rather than skipping them: duplication is now structurally impossible, so re-reading one is free, while skipping it can only lose data — a conflict copy is created exactly when two machines appended to the same filename, so it may be the only place one machine's reviews exist.
- `reviewCard` appends to the log **first**, then updates SQLite. If the process dies between the two, the next `sync` picks the line up and the DB catches up. The reverse order loses data.
- Append with `O_APPEND`, write each review as a single `write()`, and `fsync` the descriptor before touching SQLite. `fsync`, not merely a flushed userspace buffer — the difference is surviving a power loss rather than only a killed process, and this is a loop paced by a human pressing keys, so the cost is irrelevant. `O_APPEND` with one-line writes far under `PIPE_BUF` is also what makes two concurrent processes interleave whole lines instead of splitting one; it is why no lock file is needed.
- Ingest is idempotent via the `UNIQUE (card_id, rated_at)` constraint, so re-reading a whole log file is always safe.
- A `.sr/log/` directory that does not exist yet is created on first write; an absent log directory is a first run, not an error.
- A line that fails to parse is skipped and counted, never fatal. The expected malformed line is a truncated final line from a crash mid-append — exactly the crash that the log-write-first ordering exists to survive, so aborting the ingest on it would defeat the rule that motivated the design.
- Exclude `.sr/` from parser scanning (section 8 step 1) so log files are never mistaken for notes.

This is the durability boundary. Notes hold content, `.sr/log/` holds history, both are plain text inside the vault, both survive this program being abandoned. Everything else is a cache.

---

## 6. Module layout

```
src/
  parser/     markdown text -> ParsedCard[]     PURE. No fs, no db.
  vault/      file walking, reading, stamp writes,  ONLY module that touches fs
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
  blockRef: string;    // "algorithms/Sorting#^sr-a7Kd9mQ2" — vault-relative
}
```

The review log is a file, so `vault/` owns it: appending a line and reading the `.sr/log/` directory both live there, not in `store/`. It is easy to file the log under `store/` because it holds review history, but that would put `fsync` and `O_APPEND` in the module whose only job is SQLite and break the one-module-per-resource rule that makes the Electron phase cheap.

`ParsedCard.lineIndex` is authoritative — it is what section 8 step 4 writes the stamp against. `cards.line_no` is a stale display convenience refreshed on each sync, and nothing may depend on it. They are two different things and only one of them is safe to build on.

**Hard rules, because these are what make the Electron phase cheap:**

1. `core` never imports `cli`. The dependency runs one way.
2. `core` functions return data. They never `console.log`, never `process.exit`, never prompt.
3. No top-level side effects in any module. Config is passed into `core`, never read from `process.env` inside it — and the same applies to the two other ambient dependencies. `now: () => Date` and `newId: () => string` live in that config object, defaulted in `cli` to the real clock and `nanoid`. Without them section 10's sync tests cannot be written at all: asserting that stamping is idempotent needs predictable IDs, and exercising the 7-day grace period needs to fast-forward eight days.
4. `parser` takes a string and returns objects. It never opens a file. This is what makes it testable and what lets a future editor plugin reuse it.
5. Long operations take an optional `onProgress` callback rather than printing.

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

`FsrsScheduler` implements it by delegating to `ts-fsrs` with default parameters. Parameter optimization is out of scope; defaults are fine until there are thousands of reviews.

---

## 8. Sync algorithm

`sync(now: Date): SyncSummary` is a batch operation. It runs on demand. It is not a watcher. Like the two functions in section 9 it takes `now` explicitly rather than reading the clock (section 6, rule 3).

1. Walk the vault directory recursively, **sorting directory entries** so walk order is deterministic across machines and filesystems. Skip:
   - `.obsidian/`, `.trash/`, any dotted directory
   - any path matching `*.sync-conflict-*` — **critical**, Syncthing conflict copies otherwise double-ingest every card in the file. Note that step 8 does the opposite for *log* files, and the asymmetry is deliberate: a review has a dedupe key, so reading a duplicate is free; a note has none, so reading a duplicate mints a second card for every line in it.
   - non-`.md` files
   - `.sr/` — the log directory, covered separately in step 8
2. For each file, read it and run the parser. Collect `ParsedCard[]`. Any card whose ID was already seen earlier in this pass is treated as unstamped (section 4).
3. If the file's mtime is within the last 2 seconds, mark it **deferred**: sync the cards in it that already carry IDs, and mint nothing. It is likely open and being edited in Obsidian.
4. Otherwise mint IDs for the unstamped lines and apply all stamps for the file in **one write**, reconstructing the file from its lines. Split so that **each line keeps its own terminator** — `/(?<=\r?\n)/` — and rejoin by concatenation, never by `join("\n")`. A CRLF file, or one with no trailing newline, must come back byte-identical apart from the stamped line itself; splitting on `\n` silently converts a whole note the first time one card in it is stamped, which shows up as a full-file diff in git and a full re-sync in Syncthing, and works against "notes stay readable and portable". Immediately before writing, stat the file again and skip the write if **`(mtime, size)`** differs from the read at step 2 — the guard in step 3 does not cover a file edited in the milliseconds *after* it was read, and the failure mode is silently reverting the user's keystrokes. Compare size as well as mtime because mtime granularity is one second on some filesystems, so two edits inside the same tick are indistinguishable by mtime alone — and this is a write path that destroys the user's typing when it guesses wrong.
5. Upsert into `cards`, **only for cards whose ID is now on disk and was written or confirmed this pass.** Nothing minted but unwritten may enter the DB — and neither does a card treated as unstamped at step 2 that received no written ID, which is the duplicate-inside-a-deferred-file case: its ID *is* on disk, but it belongs to the first occurrence, so upserting it would overwrite that card's row with the copy's path and text. Skip it entirely; it is picked up once the file goes quiet. If the parsed question or answer differs from the stored row, update them but **leave `card_state` untouched** — a typo fix must not reset scheduling. Automatic reset on edit is explicitly not wanted.
6. Clear `missing_since` **and `deleted_at`** for every ID seen this pass. A tombstone is a state, not a terminal one: a folder absent past the grace period and then restored must come back to the queue fully scheduled, and it can, because `card_state` and `reviews` were never deleted. Leaving `deleted_at` set implements only the first half of *absence is not deletion* — the card sits in the vault, its history intact, and is never shown again.
7. For rows not seen this pass, set `missing_since` if null. If `missing_since` is older than 7 days, set `deleted_at`.

8. Ingest logs. Read **every** `.jsonl` in `<vault>/.sr/log/`, conflict copies included, and `INSERT OR IGNORE` into `reviews` (the `UNIQUE (card_id, rated_at)` constraint makes re-reads free). Collect the card IDs where a row *actually inserted*; **replay exactly that set**, each card's full history through the scheduler, regardless of where the new reviews land in time. Read that history **`ORDER BY rated_at`** — never rowid order. `reviews.id` is an autoincrement reflecting *ingest* order, and a phone log that arrives three days late inserts older reviews after newer ones, so a bare `SELECT ... WHERE card_id = ?` hands the scheduler a history that is out of chronological order and silently produces wrong stability and difficulty. Chronological replay is the correctness condition the entire log design rests on; it has to be spelled in the query. Finally, lower `created_at` for any card whose earliest ingested review predates it (section 5).

Steps 3–5 hold one invariant: **an ID exists in the DB only if it exists in the vault.** Mint, write, then upsert — never mint, skip the write, and upsert anyway. The wrong order means a card authored while its file is open in Obsidian gets an ID and a row, loses the stamp, is re-minted on the next pass as a second card, and the first row is then marked missing and tombstoned seven days later. Every card written into an open file would grow a ghost twin. The cost of the correct order is that such a card waits for the next sync, which is what the mtime guard was buying anyway.

Step 7 is the important one. **Absence is not deletion.** A card missing from the vault is far more likely to be a file that hasn't synced yet than a card the user removed. Never hard-delete; the grace period costs nothing.

Step 8 is what makes multi-device work: reviews done on the phone arrive as new lines in `phone.jsonl` and fold into local state on the next sync, with no merge logic and no conflict resolution. Phase 1 can re-read log files in full every sync — they will be small for a long time. Track byte offsets only once that becomes slow.

Conflict copies in the log directory are ingested, not skipped. Uniqueness on `(card_id, rated_at)` makes double-ingest structurally impossible, so re-reading one costs nothing — whereas skipping it can only lose data, since a conflict copy is created exactly when two machines appended to the same filename and therefore holds reviews that exist nowhere else. Never delete or rewrite one; section 5a's append-only rule covers files this program did not create. Count them in the summary so the user finds out two devices are sharing a name.

**Step 8 never writes to the vault; steps 1–7 do.** It does write to SQLite — that is its job — but it opens no note and mints no ID, and that is the property which lets `review` and `stats` run it implicitly (section 9) with no risk of touching the user's files.

The replay set must be driven by what actually inserted, never by comparing against `card_state.last_review`. Arriving late and being late are different things: a phone offline for three days produces reviews that are all *older* than what has already been folded in, so a "newer than `last_review`" test skips them and their history stays in the durable log but permanently absent from scheduling. That case is the entire reason the per-device log exists.

Clock skew is the one thing this ordering cannot survive. A device with a badly wrong clock mis-orders its reviews permanently, and no rebuild repairs it. Accept it: the fix is a vector clock, and section 11's last paragraph is about resisting exactly that.

Two failures are handled differently on purpose. A `vaultPath` that is missing or is not a directory is a **configuration error**: fail loudly and exit non-zero, because every count the run would report is meaningless and a silent zero-card sync looks like success. An individual file that cannot be read or parsed is **skipped and counted**, never fatal — one bad file must not stop the other nine hundred, and the summary is where the user finds out. The same asymmetry governs the log: a missing log directory is a first run, a single unreadable line is a skip.

Return a summary object: files scanned, files deferred, cards found, new, updated, newly missing, tombstoned, duplicate IDs re-minted, reviews ingested, conflict log files read, files skipped on error, log lines skipped.

---

## 9. Review flow

```ts
getDueCards(now: Date, limit?: number): DueCard[]
reviewCard(cardId: string, rating: 1|2|3|4, now: Date): void
```

`getDueCards` returns cards where `card_state.due <= now` or no state row exists, excluding tombstoned cards. A card with `missing_since` set is **still reviewable**: its file has probably not synced yet, the question and answer are in the DB, and refusing to show it would punish the user for Syncthing being slow. Only a tombstone — seven days of continuous absence — takes a card out of the queue. Due cards first, ordered by `due` ascending — most overdue first — then new cards by `(created_at, file_path, line_no)` ascending. The tiebreak is not decoration: a rebuild gives every never-reviewed card the same `created_at`, so ordering on it alone degenerates to whatever SQLite happens to return and a rebuild silently reshuffles the new-card queue. Path-then-line is stable across rebuilds and matches the order the cards read in the vault. Deterministic and testable; no randomization in phase 1. No burying, no sibling logic, no daily limits.

`limit` defaults to 50 and the CLI exposes `--limit` (short form `-n`). A months-long gap produces a queue in the thousands, and the point of surviving that gap is undermined by a session that cannot be ended; print `50 of 1240 due`. There is deliberately no *persistent* daily-limit state — that would be durable state living outside the two places section 5a declares durable.

One consequence is worth knowing before it surprises you: due cards are served ahead of new ones, so a backlog larger than `limit` starves new cards completely until it clears. That is the intended trade — recovering what you already half-know beats piling on more — and the escape hatch is a larger `-n`, not a scheduling rule.

`reviewCard` appends one line to this device's log file, `fsync`s it, then inserts into `reviews` and upserts `card_state` in a transaction. **The log write comes first.** A crash between the two leaves the DB behind by one review, which the next sync repairs; the reverse order loses the review outright.

`review` and `stats` first run section 8's **step 8 only** — ingest the logs and replay — and nothing else. Without it the ordinary multi-device morning serves you cards the phone already did last night and rates them a second time at a near-zero interval. Step 8 writes to SQLite but opens no note, and takes milliseconds on a small log; the vault walk and the stamp writes stay exclusive to `sync`.

CLI:

```
vault-sr init <path>     write ~/.config/vault-sr/config.json
vault-sr sync            scan vault, stamp IDs, ingest logs, update db
vault-sr review [-n N]   interactive loop, default 50 cards; ingests logs first
vault-sr stats           counts: total (live), due now, due before local midnight, new, tombstoned
vault-sr rebuild         drop all tables, then a full sync against an empty db
```

Review loop: print question → wait for any key → print answer → read `1`–`4` → record → next. `q` quits. Show the block reference under each card so the user can find its context. Build it from the **vault-relative path minus `.md`**, not the basename — `algorithms/Sorting#^sr-a7Kd9mQ2`. Two notes in different folders can share a basename, and `[[Sorting#^sr-a7Kd9mQ2]]` then resolves to whichever one Obsidian happens to pick, so the link whose entire purpose is preserving a card's context would quietly open the wrong note.

A card rated `1` is **not** re-shown in the same session. The queue is materialized once by `getDueCards`, and FSRS puts a lapsed card a minute or so out, so it comes back on the next `vault-sr review`. This is a decision, not an oversight: re-queueing inside the session is learning-steps logic, which section 1 rules out.

`due` is an instant, so "due today" is ambiguous. `stats` reports **due now** as the actionable number, with *due before local midnight* as a separate forecast line.

---

## 10. Testing

Do not aim for coverage. Test the three places bugs are expensive:

- **Parser** — fixture strings in, expected cards out. Cover: code fences, blockquotes, headings, `foo::bar` without spaces, already-stamped lines, multiple cards per file, `::` appearing in the answer text, list-marker and task-box prefixes, an empty side, and an answer that ends in `^abc` — which must *not* be read as a stamp.
- **Sync** — against a temp directory and an in-memory SQLite. Cover: file rename preserves state, edited text preserves state, missing file sets `missing_since` rather than deleting, stamping is idempotent across two runs, a deferred file (fresh mtime) mints nothing and writes no `cards` row, a duplicated stamped line is re-minted rather than overwriting the original, a duplicate inside a *deferred* file is skipped rather than overwriting the original, a CRLF file with one stamped card differs from its original by exactly the stamped line, a card tombstoned past the grace period returns to the queue once its file comes back, and a missing vault path exits non-zero rather than reporting a zero-card success.
- **Rebuild** — the one test that protects the durability claim. Review some cards, delete the database entirely, rebuild, assert that **for every card present in the vault** `card_state` is identical. The claim is scoped that way on purpose: `created_at`, `missing_since` and `deleted_at` are not recoverable, and a card absent from the vault does not come back. Also: ingesting the same log twice changes nothing, two device logs merge in timestamp order regardless of read order, a review that arrives *out of order* still lands in `card_state` **and replays in `rated_at` order rather than ingest order**, a review for an ID no longer in the vault is ingested without error, a truncated final line is skipped rather than aborting the ingest, and a copy of a log file saved under a different name ingests zero new reviews.

That list is the whole risk surface. Everything else can be verified by using it.

---

## 11. Phase 2 sketch (do not build now)

Recorded only so phase 1 doesn't accidentally foreclose it:

- Electron shell: main process imports `core`, renderer is a review UI. No changes to `core` required if section 6's rules held.
- Cloze support: a second parser strategy; `type` column already exists.
- Anki bridge: an exporter reading `cards`, writing `.apkg`. Read-only against the store. If Anki ends up owning review history instead, the JSONL logs become a secondary record and SQLite thins to a card index — a subtraction, not a rewrite.
- FSRS parameter optimization: the logs already hold exactly what the optimizer wants, in the order it wants it.

The expandability comes from the module boundaries in section 6 and the append-only logs in section 5a. It does not come from configuration surfaces, plugin systems, or premature interfaces. Resist adding those.