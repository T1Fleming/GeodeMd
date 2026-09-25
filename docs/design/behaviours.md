# Behaviours

**Generated. Do not edit.** Every line below is the name of a test, assembled by
`src/behaviours/reporter.ts` from the run that `npm test` just performed — so this
file cannot describe a behaviour the suite does not check. `npm test` rewrites it, so
a change here in a diff is a change in what GeodeMD does, and a stale copy shows up
as an uncommitted change.

It answers two questions the suite, organised by module, could not: *what does this
app do*, and *where is that proven*. What it deliberately cannot tell you is what the
app does **untested** — an area that looks thin here is thinly covered, and that is
worth reading as a finding rather than a gap in the document.

574 behaviours in 12 areas, which follow [the guides](../guides/) rather than the source tree.

- [Reviewing](#reviewing) — 151
- [Recognising a card](#recognising-a-card) — 57
- [Syncing notes](#syncing-notes) — 74
- [Recovery and the log](#recovery-and-the-log) — 27
- [Moving between machines](#moving-between-machines) — 16
- [Keeping several vaults](#keeping-several-vaults) — 45
- [Setting up this machine](#setting-up-this-machine) — 77
- [The app's long runs](#the-apps-long-runs) — 31
- [The database as a cache](#the-database-as-a-cache) — 7
- [At scale](#at-scale) — 9
- [Rules the project enforces on itself](#rules-the-project-enforces-on-itself) — 34
- [The documentation tells the truth](#the-documentation-tells-the-truth) — 46

## Reviewing

_A session: which card is next, what the keys mean, what a rating records, and what comes back before the sitting ends._

**151 behaviours.**

### the order cards are served in

_7 · `core/review.test.ts`_

- orders new cards by (file_path, line_no) — the order they read
- is stable across a rebuild
- serves due cards ahead of new ones, most overdue first
- respects the limit across both queries
- starves new cards when the due backlog exceeds the limit
- builds a locator from the notes-relative path and line
- carries the path and line as data, not only as a display string

### recording a review

_4 · `core/review.test.ts`_

- writes the log BEFORE SQLite
- omits elapsed and scheduled on a first review, and includes them after
- recovers a review that reached the log but not the database
- puts a lapsed card back within minutes, not the same session

### reporting what is due and what is new

_4 · `core/review.test.ts`_

- counts total, due now, due before local midnight, and new
- reports the counts as exact when nothing hit the cap
- says so when a count stopped at the cap
- does not count a deleted card's surviving state as due

### a review while another writer holds the lock

_6 · `core/busy.test.ts`_

- fails in the way the app is written to expect
- has already made the rating durable before SQLite is touched
- leaves the card's state untouched rather than half-written
- is repaired by the next ingest, with nothing lost
- does not duplicate the review when the ingest replays it
- succeeds normally once the lock is released

### an unanswered queue

_3 · `host/queue.test.ts`_

- serves the snapshot in order
- is empty when it was built from nothing
- does not hold on to the caller's array

### a card that was rated

_6 · `host/queue.test.ts`_

- leaves the screen at once, but is still owed until the scheduler answers
- comes back when FSRS put it on a learning step
- is gone for the session once it graduates
- is gone when the new state could not be learned
- ignores an answer for a card that is not in flight
- is treated as due now if its due date will not parse

### the end of the queue

_3 · `host/queue.test.ts`_

- serves a waiting card early rather than idling
- serves the earliest of several early
- is over only when every card has graduated

### the order waiting cards come back in

_2 · `host/queue.test.ts`_

- is by due time, earliest first
- keeps the order they were rated in when two are due together

### setting a card aside

_5 · `host/queue.test.ts`_

- moves it behind the cards not yet seen
- returns the only card there is, rather than pretending
- takes a waiting card off its learning step, because it had ripened
- comes back rather than pulling a waiting card early
- never loses a card or invents one

### the pinned parameters

_2 · `host/queue.test.ts`_

- keeps every short-term step inside the same sitting
- puts a lapsed review card back on one

### what a keypress means

_4 · `host/present.test.ts`_

- maps 1-4 to ratings
- quits on q, Q, Ctrl-C, and escape in both spellings
- opens the source note on o
- ignores anything else rather than recording a rating nobody chose

### the shared vocabulary

_7 · `host/present.test.ts`_

- names all four FSRS ratings, in order
- agrees with interpretKey about every key it advertises
- offers `later` only at the question and `open` only at the answer
- offers `annotate` at the answer only, because an annotation may restate it
- treats every key as text while an annotation is open, except the two that close it
- offers quit at both stages, because a question you cannot leave is a trap
- maps 0 to defer, which records nothing

### which ratings a session summary mentions

_3 · `host/present.test.ts`_

- stays quiet about ratings that were never given
- reports in rating order, not insertion order
- is empty for a session with no answers in it

### which program opens a note

_2 · `host/editor.test.ts`_

- prefers the config key, then VISUAL, then EDITOR
- is null when nothing names an editor

### finding an editor that is not on the app's PATH

_6 · `host/editor.test.ts`_

- uses the command on PATH when it is there
- finds a Mac app's launcher inside its bundle when PATH has none
- looks in ~/Applications as well
- does not look in app bundles off macOS
- checks a full path rather than searching for it
- is null when it is nowhere

### listing the editors installed here

_5 · `host/editor.test.ts`_

- lists what is installed, found on PATH or only in a bundle
- stores a plain name, not the path it was found at
- is empty when nothing is installed
- never offers a terminal editor, which would start with no TTY to type into
- offers only editors that can be put on the card's line

### what o runs

_5 · `host/editor.test.ts`_

- runs the resolved file, with the line flag chosen by name
- still lands on the line when the launcher has another name
- keeps the extra words of a typed command
- is an error, not the OS opener, when a named editor is not installed
- uses the OS opener, unlooked-up, when no editor is named

### how an editor is told which line

_10 · `host/editor.test.ts`_

- uses +LINE for the Unix family
- uses --goto for the VS Code family
- appends the line to the path for editors that read it there
- carries the user's own flags through
- recognises an editor named by its full path
- gives an unfamiliar editor the path and nothing else
- omits the line when there is none to give
- falls back to the platform opener when no editor is named
- never routes a path through cmd.exe, which would re-parse it
- never passes a line to the OS opener, which cannot use one

### noticing a note you edited while reviewing

_5 · `host/editor.test.ts`_

- reports a note that was edited while it was open
- says nothing about a note that was only looked at
- keeps the mtime from the FIRST open, not the most recent
- counts a note that disappeared, and one that appeared
- narrows to the paths asked about

### revealing

_3 · `electron/renderer/model/session.test.ts`_

- starts hidden, because the point is to recall it first
- reveals on any key that is not a quit
- quits from the question too, not only from the answer

### rating

_3 · `electron/renderer/model/session.test.ts`_

- does nothing before the answer is showing
- records the rating and moves on once revealed
- is over when every card has graduated

### a card on a learning step

_9 · `electron/renderer/model/session.test.ts`_

- comes back in the same session
- goes ahead of a card that has not been seen yet, once it is due
- does not replace the card being read the moment it ripens
- is answered again, and counted again
- makes the counter's denominator grow, because a second answer is owed
- keeps the session alive while the rating is in flight
- does not come back when the scheduler graduated it
- does not come back when the write failed and its state is unknown
- ignores a key pressed while nothing is on screen

### opening the note

_3 · `electron/renderer/model/session.test.ts`_

- is offered only once the answer is showing, like the CLI
- records each opened note once, for the end-of-session check
- does not advance the card

### keys it does not know

_2 · `electron/renderer/model/session.test.ts`_

- ignores them once revealed rather than guessing
- does nothing at all once the session is over

### an empty queue

_1 · `electron/renderer/model/session.test.ts`_

- is over immediately, with nothing to show

### deferring

_11 · `electron/renderer/model/session.test.ts`_

- moves the card to the back and shows the next one
- does not advance the counter, because nothing was answered
- records nothing at all — no effect, no rating
- is the second exception to `any key reveals`
- does nothing once the answer is showing
- keeps the session alive — a deferred card is still owed an answer
- comes back round, so the card is genuinely still reachable
- returns the only remaining card immediately, rather than pretending
- still lets the card be answered normally afterwards
- does not lose a card that was deferred and then answered
- works on a card that came back on a learning step

### annotating a card

_13 · `electron/renderer/model/session.test.ts`_

- asks whether the card has an annotation when it is revealed, not before
- does nothing with `a` at the question stage, not even the reveal
- opens with `a` once the answer is showing, holding the existing text
- does not open before the annotation has arrived, so it cannot be overwritten blank
- gives 1-4, q, 0 and o no effect and records nothing while annotating
- says which keys belong to the text box, so the screen does not swallow them
- leaves annotating on Escape without quitting, and saves what was typed
- saves and closes on Cmd+Enter too
- closes without a write when nothing changed
- keeps the box open with the text in it when the save fails
- clears the annotation when saved blank
- still rates normally once the box is closed
- ignores an annotation that arrives for a card no longer on screen

### launching an editor without holding the app open

_5 · `electron/main/open.test.ts`_

- reports an editor that is not installed, rather than claiming success
- reports a launcher that vanished between the lookup and the spawn
- returns as soon as the process exists, not when it exits
- does not keep the event loop alive waiting for the child
- passes the line through the same table the CLI uses

### the editor setting on the Vault screen

_5 · `electron/renderer/model/editor.test.ts`_

- offers the system default, what is installed, and a typed command, in that order
- shows the system default when no editor is set
- shows an installed editor as itself
- shows an editor that is not installed as a typed command, not as the default
- saves a choice at once, except a typed command, which waits to be typed

### a card's annotation

_7 · `files/files.test.ts`_

- is null for a card that has none, and reads back what was written
- is replaced whole by a second write
- is removed by empty or blank text rather than left as an empty file
- refuses an id that is not a stamp, before it becomes a path
- leaves no partial or temporary file behind, whether the write succeeds or fails
- comes back byte-identical, CRLF and missing final newline included
- is never walked as a note, so a ` :: ` inside one is not a card

## Recognising a card

_Text in, cards out. Also — and mostly — the shapes that are deliberately NOT cards, because a false positive writes a stamp into someone's note._

**57 behaviours.**

### the basic form

_3 · `parser/parser.test.ts`_

- splits on the first separator and trims both sides
- reports a 0-based lineIndex
- finds multiple cards in one document

### `::` without surrounding whitespace is not a separator

_4 · `parser/parser.test.ts`_

- foo::bar
- key::value in a field
- a ::b
- a:: b

### a later separator is answer text

_1 · `parser/parser.test.ts`_

- keeps `::` in the answer — one line is always at most one card

### leading list markers are stripped from the question

_9 · `parser/parser.test.ts`_

- - Q :: A
- * Q :: A
- + Q :: A
- 1. Q :: A
- 12. Q :: A
- 1) Q :: A
- - [ ] Q :: A
- - [x] Q :: A
-   - Q :: A

### an empty side is not a card

_5 · `parser/parser.test.ts`_

- " :: A"
- "Q :: "
- " :: "
- "- :: A"
- is empty when the answer is nothing but a comment

### stamps

_8 · `parser/parser.test.ts`_

- keeps an existing id and excludes it from the answer
- strips a non-stamp trailing comment from the answer
- strips a trailing comment that sits after a stamp
- does not read a bare ^token as a stamp
- is not a stamp: wrong length
- is not a stamp: no prefix
- is not a stamp: illegal char
- is not a stamp: not at end of line

### skipped contexts

_14 · `parser/parser.test.ts`_

- skips fenced code blocks
- skips tilde-fenced code blocks
- resumes after a fence closes
- does not close a backtick fence with a tilde fence
- skips indented code blocks (four spaces)
- skips indented code blocks (tab)
- skips a separator inside an inline code span
- still parses a card whose answer contains a closed code span
- skips table rows
- skips blockquotes and headings
- skips YAML frontmatter
- parses cards after frontmatter closes
- does not swallow the note when frontmatter is never closed
- treats `---` below line 1 as ordinary text, not frontmatter

### splitLines keeps each terminator

_5 · `parser/parser.test.ts`_

- preserves LF
- preserves CRLF
- preserves a missing final terminator
- preserves a mixed file byte-for-byte when rejoined
- returns nothing for empty input

### writing a stamp into a line

_6 · `parser/parser.test.ts`_

- appends a stamp to an unstamped line
- replaces an existing stamp rather than appending a second
- leaves a non-stamp comment in place and stamps after it
- does not accumulate whitespace
- rejects an id that is not the minted shape
- round-trips: a stamped line parses back to the same id and answer

### reading a stamp back off a line

_2 · `parser/parser.test.ts`_

- returns the id and the remainder
- returns null when there is no stamp

## Syncing notes

_Finding what changed, stamping it, pruning what is gone, and saying what happened._

**74 behaviours.**

### which counts a sync summary shows

_6 · `host/present.test.ts`_

- always reports the core counts, even at zero
- stays quiet about incidentals at zero
- surfaces a skipped file, which the exit code deliberately does not
- puts filesStamped ahead of the other incidentals
- marks unchanged and read as a breakdown of files, and nothing else
- keeps a detail next to the field it breaks down

### why a freshly-edited file was left alone

_4 · `host/present.test.ts`_

- says nothing when nothing was deferred
- explains why, because the counts alone read as a bug
- agrees with itself about plurals
- leaves what to do about it to the interface

### what each sync phase is called

_1 · `host/present.test.ts`_

- names every phase core can report

### stamping

_6 · `core/sync.test.ts`_

- mints an id, writes it to the note, and creates the card row
- is idempotent across two runs
- preserves a CRLF file byte-for-byte apart from the stamped line
- preserves a missing final newline
- stamps every card in a file in one write
- does not stamp inside a code block

### the write guard

_5 · `core/sync.test.ts`_

- mints nothing in a file whose mtime is inside the deferral window
- syncs already-stamped cards in a deferred file
- re-reads a deferred file on the next sync rather than calling it unchanged
- still records a deferred file that needed no minting
- picks the deferred card up once the file goes quiet

### identity across moves and copies

_7 · `core/sync.test.ts`_

- a renamed file keeps the card id and its row follows the new path
- an edited question keeps the id and does not reset scheduling
- re-mints a duplicated stamped line and REPLACES its stamp
- skips a duplicate inside a DEFERRED file rather than overwriting the original
- re-mints a card COPIED into a second file
- tells a copy from a move within ONE file, per card
- keeps the id for a card MOVED to a second file

### configuration errors versus skips

_2 · `core/sync.test.ts`_

- throws on a missing notesPath rather than reporting a zero-card success
- throws when notesPath is a file, not a directory

### incremental sync

_6 · `core/sync.test.ts`_

- writes NOTHING when nothing changed
- does not open an unchanged file, and does open a changed one
- --full reads every file even when unchanged
- records the POST-write mtime so the next run sees no change
- loses exactly the cards deleted from a file
- triggers the reconciliation pass only when a file vanished

### progress reporting

_3 · `core/sync.test.ts`_

- reports every enumerated file, including the ones the cache skips
- moves through the phases in order
- is optional — a caller that passes nothing is unaffected

### filesStamped

_3 · `core/sync.test.ts`_

- counts files edited, not cards — one file with many new cards is one
- is zero on a second sync, when nothing needs a stamp
- does not count a file whose cards were all deferred

### --dry-run

_3 · `core/sync.test.ts`_

- reports how many files it WOULD edit, having edited none
- writes neither a stamp nor a row, and still reports what would happen
- leaves the real sync free to do the work afterwards

### prune

_2 · `core/sync.test.ts`_

- removes card rows but leaves reviews and card_state untouched
- restores a card on its original schedule, NOT queued as new

### sync conflict copies

_8 · `core/sync.test.ts`_

- does not mint a second id for every card in the copy
- leaves the copy's bytes untouched
- does not disturb the original or its history
- reports the count on every sync, not only the first
- counts it as a conflict rather than as unchanged
- still enumerates it, so nothing is pruned by its absence
- does not read it, so its cards are not counted as found
- leaves an ordinary file that merely looks similar alone

### annotation files

_1 · `core/sync.test.ts`_

- are never enumerated or stamped, even with a card-shaped line in them

### walking the notes tree

_9 · `files/files.test.ts`_

- returns .md files with paths relative to the root
- is deterministic — entries are sorted
- skips non-.md files
- skips every dotted directory
- does not descend into a symlinked directory, and counts it
- does not follow a symlinked file either
- reports mtime and size
- interleaves files and subdirectories in sorted order, at every depth
- gives every candidate its OWN stat, not a neighbour's

### refusing to write over someone else's edit

_4 · `files/files.test.ts`_

- writes and returns the POST-write stat
- refuses to write when size changed since the read
- refuses to write when mtime changed but size did not
- returns null when the file vanished

### recognising a syncer's conflict copy

_4 · `files/files.test.ts`_

- catches Syncthing's shape
- catches Dropbox and Nextcloud, with or without an owner's name
- leaves ordinary filenames alone, including the ambiguous ones
- judges the filename, not the folder it sits in

## Recovery and the log

_The append-only review log, and rebuilding the database from nothing but notes and logs._

**27 behaviours.**

### the review log

_7 · `files/files.test.ts`_

- names a shard by device and the month of the timestamp
- puts a review either side of midnight into different shards
- creates the log directory on first write
- appends rather than truncating
- omits elapsed and scheduled when they are not supplied
- treats an absent log directory as a first run, not an error
- lists any .jsonl whatever it is named, and ignores other files

### reading a log shard from where it left off

_4 · `files/files.test.ts`_

- reads from an offset only
- stops at the last COMPLETE line and leaves the offset before a partial one
- returns nothing when there is no complete line at all
- returns nothing when the offset is already at EOF

### rebuilding from notes and logs

_4 · `core/rebuild.test.ts`_

- reproduces cards, files, reviews and card_state IDENTICALLY, in full
- is a differential test between fold-forward and from-scratch replay
- catches cards.reviewed drifting out of agreement with card_state
- a card authored while the database was gone still gets its id

### ingesting the log

_11 · `core/rebuild.test.ts`_

- ingesting the same log twice changes nothing
- merges two shards in timestamp order regardless of read order
- a review arriving OUT OF ORDER replays in rated_at order, not ingest order
- ingests a review for an id no longer in the notes without error
- skips a truncated final line rather than aborting the ingest
- completes a truncated line on the following run
- a copy of a shard under a different name ingests zero new reviews
- does not open a frozen shard whose size is unchanged
- reads only the appended bytes when a shard grows
- re-reads from zero when a shard shrank
- counts an unparseable line as skipped, never fatal

### annotations and the database

_1 · `core/rebuild.test.ts`_

- stay out of it: a rebuild with annotations present reproduces it identically

## Moving between machines

_One notes directory, two devices, no built-in sync transport._

**16 behaviours.**

### two machines, one notes directory

_8 · `core/two-devices.test.ts`_

- agree on card identity without ever talking to each other
- write to separate log shards, so a syncer never has to merge one file
- each picks up the other's reviews on the next ingest
- converge on identical scheduling state, not merely on both having some
- re-ingesting the same shards changes nothing
- replays in the order things were RATED, not the order they arrived
- survives a machine that has never seen the notes before
- does not need the database to travel

### both machines stamping before they ever exchange

_1 · `core/two-devices.test.ts`_

- converges on one set of ids rather than duplicating the cards

### reading the queue

_3 · `electron/main/reads.test.ts`_

- picks up a review another machine already recorded
- repairs the gap a crash leaves between the log and the database
- is a no-op when nothing new has arrived

### reading the counts

_1 · `electron/main/reads.test.ts`_

- counts a card answered elsewhere as reviewed, not as new

### concurrent reads

_1 · `electron/main/reads.test.ts`_

- shares one ingest between dueCards and counts requested together

### a busy database

_2 · `electron/main/reads.test.ts`_

- is not allowed to cost the user their session
- still reports a failure that is not a busy database

## Keeping several vaults

_Several notes folders, each with its own database, one open at a time — adding, switching, and the overlap that would split a card's history._

**45 behaviours.**

### refusing two vaults that share notes

_8 · `host/vaults.test.ts`_

- refuses a folder inside an existing vault
- refuses a folder that contains an existing vault
- refuses the same folder twice
- sees through a symlink, which would otherwise get round the check
- allows two unrelated folders, including ones that merely share a prefix
- still counts a vault whose folder is missing, as an unplugged drive would be
- does not count the vault being re-pointed against itself
- says which vault, and why that matters, in one sentence

### switching between vaults

_4 · `electron/main/active.test.ts`_

- opens whichever vault the config names, lazily
- reads no files on coming back to a vault, because its cache survived the switch
- keeps each vault's cards and schedules its own
- drops the old Store on a switch rather than keeping it open

### switching while something is running

_3 · `electron/main/active.test.ts`_

- is refused during a sync, and leaves the Store and the config alone
- refuses to open a vault while a switch is part-way through
- leaves the open vault open when the write itself is refused

### the end of a session a switch interrupted

_2 · `electron/main/active.test.ts`_

- answers which notes changed in the vault being left, before it is closed
- has nothing to answer when no vault was open

### a write composed in a vault that has since been left

_1 · `electron/main/active.test.ts`_

- is refused rather than landing in the vault open now

### the vault switcher

_4 · `electron/renderer/model/vaults.test.ts`_

- lists every vault by name, then a way to add one
- switches straight to a vault already added — there is nothing to preview
- sends adding one into the setup sequence instead
- does nothing when the open vault is chosen again, or an unknown one

### removing a vault from the list

_1 · `electron/renderer/model/vaults.test.ts`_

- is not offered for the open vault, and says why

### notes edited in the vault just left

_2 · `electron/renderer/model/vaults.test.ts`_

- names the vault, since its notes are no longer the ones on screen
- says nothing when nothing changed, or nothing was open

### keeping a list of vaults

_13 · `host/host.test.ts`_

- gives an added vault its own database, and makes it the open one
- shares device and editor across vaults, since both are about the machine
- uses the id the proposal showed, and replaces one that is malformed or taken
- names two vaults apart even when their folders share a name
- refuses to add a vault that overlaps one already in the list
- switches by changing only which vault is active
- renames a vault without moving anything, and refuses a blank or taken name
- will not remove the open vault
- removes a vault without touching its notes or its log
- deletes a removed vault's database only when asked, and its directory with it
- re-points the open vault, keeping its id and its database
- keeps a name the user chose when the vault is re-pointed
- refuses to re-point a vault into another one

### adding a vault beside the open one

_7 · `electron/renderer/model/setup.test.ts`_

- opens at the folder step, and ends in an add rather than a re-point
- asks for the new vault's folder first
- refuses a folder that overlaps another vault, on the folder step
- has no keep-or-replace question, because nothing is replaced
- still goes through the preview, because the first sync of a new vault stamps its notes
- can be cancelled
- undoes the vault it added — the one written, even after picking again

## Setting up this machine

_Config, XDG paths, the device name, and the first run._

**77 behaviours.**

### where the config lives

_5 · `host/host.test.ts`_

- uses the geodemd directory, while the command stays `geode`
- is Application Support on macOS (ADR 0026)
- is ~/.config elsewhere
- honours an explicit XDG_CONFIG_HOME on macOS too
- leaves the database default where it was

### moving an old Mac config into Application Support

_4 · `host/host.test.ts`_

- moves it, so an existing install does not open to first-run setup
- never overwrites a config already at the new path
- keeps using the old file when the move fails
- does nothing on a first run, off macOS, or under XDG_CONFIG_HOME

### minting a card id

_2 · `host/host.test.ts`_

- mints the shape section 4 specifies
- does not repeat

### naming this device

_3 · `host/host.test.ts`_

- slugifies the hostname and appends a suffix
- gives two identically-named machines different names
- copes with a hostname that slugifies to nothing

### writing a config for the first time

_6 · `host/host.test.ts`_

- writes the three keys
- refuses to overwrite an existing config
- preserves device under --force
- reads an editor when one is set, and nothing when it is not
- preserves editor under --force, like device
- returns null for a missing or malformed config

### choosing an editor from the app

_5 · `host/host.test.ts`_

- sets the editor and keeps every other key
- removes the key for the system default
- treats a blank value as the system default
- persists a device rather than minting a new one on every write
- is null when there is no config to set it in

### reading a config, and healing a missing device

_6 · `host/host.test.ts`_

- readConfig alone hands out a different device every time
- mints a device once and persists it
- leaves an existing device alone and writes nothing
- leaves exactly one device behind when two heals race, and settles after
- does not leave temp files behind
- is null for a missing config, like readConfig

### migrating a single-folder config into a vault

_5 · `host/host.test.ts`_

- keeps device, dbPath and editor, so this machine's history stays in one shard
- reads back as one vault, named after its folder and active
- keeps the database where the old default put it, rather than moving it under vaults/
- migrates once: the vault id is persisted, and the next read writes nothing
- leaves the old config readable when the migration cannot be written

### classifying an error

_1 · `host/host.test.ts`_

- classifies while the error still has its prototype

### recognising a busy database

_4 · `host/host.test.ts`_

- recognises both busy codes SQLite produces
- does not treat other SQLite failures as retryable
- survives anything at all being thrown
- reads the property rather than the class, which does not survive IPC

### what the folder you chose contains

_7 · `host/setup.test.ts`_

- counts the markdown files a sync would actually read
- counts the same way enumerate does, dotted directories included
- reports an empty folder rather than refusing it
- notices a git repository, because that changes which warning is honest
- says so when the path is gone
- tells a file apart from a missing path
- resolves the path it reports back

### what writing a config would change

_5 · `host/setup.test.ts`_

- proposes a fresh device and the default db path on a first run
- keeps the device when there is already a config, and says that it did
- mentions editor only when there is one to keep
- writes nothing
- resolves a relative notesPath, as init would

### telling a moved folder from a first run

_1 · `host/setup.test.ts`_

- is a question inspectFolder answers, so the two get different screens

### choosing a folder

_4 · `electron/renderer/model/setup.test.ts`_

- will not move on until one is chosen
- accepts an empty folder, because starting from nothing is legitimate
- refuses a path that is not a directory
- lands on the confirm step

### an existing config

_4 · `electron/renderer/model/setup.test.ts`_

- makes using the new folder an explicit choice
- treats keeping the old settings as a way out, not a way forward
- is not asked at all on a first run
- re-opens the question when a different config is proposed

### the acknowledgement

_1 · `electron/renderer/model/setup.test.ts`_

- is required exactly once, and blocks nothing else

### the preview gate

_3 · `electron/renderer/model/setup.test.ts`_

- is what makes the real sync reachable at all
- is cleared by choosing a different folder
- survives stepping back and forward over the same folder

### walking the steps

_2 · `electron/renderer/model/setup.test.ts`_

- does not advance past a blocker
- goes forward and back through every step in order

### pointing a working config at a different folder

_8 · `electron/renderer/model/setup.test.ts`_

- opens at the folder step, not the welcome
- asks for a folder before anything else
- refuses the folder already in use
- can be cancelled, where a repair and a first run cannot
- has nothing to undo until a preview has written the config
- puts the original folder back once one has, even after picking again
- says the old cards stay put when the new folder is empty
- restores for a repair too, and never for a first run

### what the preview says would change

_1 · `electron/renderer/model/setup.test.ts`_

- reports notes edited from filesStamped, not from cardsNew

## The app's long runs

_Single-flight, progress, and how a window that missed an event catches up._

**31 behaviours.**

### single-flight

_3 · `electron/main/runs.test.ts`_

- a second sync JOINS the first rather than failing
- a rebuild cannot join a sync
- frees the slot when the run ends

### progress

_3 · `electron/main/runs.test.ts`_

- emits on the timer, not on every callback
- always ends at 100%, even if the throttle dropped the last update
- carries the run id and kind on every emit

### results

_2 · `electron/main/runs.test.ts`_

- returns a summary rather than throwing
- tags a missing notes directory as config, not internal

### the wire types survive structuredClone

_2 · `electron/main/runs.test.ts`_

- clones every payload a real run produces
- and core's own Config does NOT — which is why the wire type differs

### status survives a missed event

_5 · `electron/main/runs.test.ts`_

- distinguishes never-run from finished
- keeps the last result, so a late subscriber can still learn it
- reports running while a run is in flight
- a new run supersedes the previous result rather than aging it out
- status is structured-cloneable, like every other payload

### how far along a run is

_3 · `electron/renderer/model/run.test.ts`_

- is zero before the total is known, rather than NaN
- clamps, because done can legitimately exceed total
- rounds to whole percent

### adopting a run the window did not start

_4 · `electron/renderer/model/run.test.ts`_

- adopts a run already in flight when a window mounts late
- adopts a result the window was never subscribed for
- tells never-run apart from finished
- carries a failure across as a failure, not an empty summary

### naming the phase a run is in

_1 · `electron/renderer/model/run.test.ts`_

- names the phase rather than showing the enum

### events out of order

_5 · `electron/renderer/model/run.test.ts`_

- does not put a finished run back on the bar
- ignores a straggler from the previous run
- lets a newer run supersede an older one
- orders run ids numerically, not lexically
- ignores a finish for a run that is not the current one

### dryRun travels with the run

_2 · `electron/renderer/model/run.test.ts`_

- so a window that joined one does not claim notes were written
- and is visible while it is still running

### whether anything is running

_1 · `electron/renderer/model/run.test.ts`_

- is true only in flight, because rebuild is refused while anything runs

## The database as a cache

_Schema decisions the rest of the system leans on, and what they cost._

**7 behaviours.**

### opening the database

_3 · `store/store.test.ts`_

- creates the parent directory on a first run
- keeps `files` a rowid table, which step 6's bitmap depends on
- stores `reviews` WITHOUT ROWID, so there is no ingest-order column

### counting what is due

_2 · `store/store.test.ts`_

- stops at the limit rather than counting a backlog out
- still ignores state that outlived its card

### checkpointing

_2 · `store/store.test.ts`_

- folds the write-ahead log back into the database
- is harmless with nothing to fold

## At scale

_The properties that must hold at a million cards._

**9 behaviours.**

### the invariant that is not a time at all

_4 · `core/scale.test.ts`_

- a sync that finds nothing changed performs ZERO writes
- holds at a larger card count too — it is not a small-tree accident
- a single-file change reads exactly one file
- deleting a file is the only thing that triggers the reconciliation pass

### shape, not seconds

_3 · `core/scale.test.ts`_

- a no-change sync scales with FILE count
- a no-change sync is FLAT in cards per file
- getDueCards is flat as the collection grows

### enumeration strategies

_2 · `files/enumerate.bench.test.ts`_

- wide (100/dir) — 20000 files _(skipped)_
- narrow (4/dir) — 20000 files _(skipped)_

## Rules the project enforces on itself

_Module boundaries, and the completeness of this document — both checked by scanning source text rather than trusted._

**34 behaviours.**

### section 6 hard rules

_6 · `boundaries.test.ts`_

- rule 1: core never imports the interface
- rule 1: nothing below the interface imports it
- rule 2: core never writes to the terminal, exits, or prompts
- rule 3: core reads no ambient config
- rule 4: parser opens no file
- parser touches no database and no clock

### one module per external resource

_4 · `boundaries.test.ts`_

- only store/ imports better-sqlite3
- only store/ writes SQL
- the log lives under files/, not store/
- scheduler pins its parameters rather than inheriting them

### host, which the interface draws from

_10 · `boundaries.test.ts`_

- never writes to the terminal
- is where ambient machine state is read, so core does not have to
- owns the review vocabulary, so the renderer cannot quietly redecide it
- owns which keys are offered at which point in a card
- owns when a rated card comes back, so a session means the same in both
- owns which program opens a note, and how it is told a line
- owns what a sync summary says, so the two cannot report differently
- leaves the spawn to each interface, because the two are not the same
- is the only place above core that walks the notes tree
- core does not import host either — it takes its config as an argument

### the journeys stay journeys

_4 · `boundaries.test.ts`_

- has one per guide, and every one of them reads its guide
- never reads the cache to prove a claim
- names every group as a sentence rather than after a function
- asserts something in every single test

### electron, the interface

_2 · `boundaries.test.ts`_

- nothing below the interfaces imports electron
- keeps onProgress out of the wire types

### every behaviour has a home

_3 · `behaviours/areas.test.ts`_

- classifies every test file
- classifies every group in every file
- finds groups in every file it classifies, so the scan cannot silently fail

### the taxonomy itself

_5 · `behaviours/areas.test.ts`_

- points every file and override at an area that exists
- names a file that exists for every override
- names a group that exists for every override
- keeps every area in use
- gives every area a blurb, because a bare heading explains nothing

## The documentation tells the truth

_Documents that make checkable claims, checked._

**46 behaviours.**

### the demo collection

_2 · `demo.test.ts`_

- holds the number of cards its README advertises
- is unstamped, so a reader sees what they would write themselves

### syntax.md keeps its promises

_5 · `demo.test.ts`_

- skips every shape it demonstrates
- does not read the inline code span as a card
- strips list markers and task boxes from the question
- strips a trailing comment that is not a stamp
- keeps a later separator as answer text

### the examples the guide shows a reader

_4 · `journeys/first-sync.test.ts`_

- shows a stamped line that really is one
- shows three shapes that are cards, and they all are
- is right that `foo::bar` is not one
- is right about every context it says is skipped

### looking before it writes

_2 · `journeys/first-sync.test.ts`_

- writes nothing on a dry run — not a stamp, not a database row
- reports the two numbers the guide tells a reader to compare

### the real sync

_2 · `journeys/first-sync.test.ts`_

- edits every file that contains a card, and only those
- leaves a second run with nothing to do, so the edit happens once

### the guide's four ratings are the four the app honours

_4 · `journeys/reviewing.test.ts`_

- names the same keys, in the same order, with the same words
- advertises no key that does nothing
- puts `0` and `o` at the stages it says they are offered at
- offers the editors it says `o` can put on a line, and no terminal ones

### the intervals the guide quotes are the ones FSRS produces

_2 · `journeys/reviewing.test.ts`_

- matches every row of the table, against the real scheduler
- is right that a long-standing card rated `1` comes back in five minutes

### a rating is safe the moment it is given

_2 · `journeys/reviewing.test.ts`_

- is in the review log on disk, which is what the guide promises
- survives quitting halfway, as the guide says it does

### the session's own claims about what you get

_2 · `journeys/reviewing.test.ts`_

- serves due cards before new ones, most overdue first
- does not walk the notes, so a deleted card can still turn up

### annotations are where the guide says, and behave as it says

_4 · `journeys/reviewing.test.ts`_

- offers `a` once the answer is showing and never before
- treats `3` and `q` as text while the box is open, and closes it on the two keys named
- keeps each one as a plain file in the notes folder, named by the card's id
- keeps a deleted card's annotation, which comes back with the card

### what the guide says is durable, and where it says it lives

_3 · `journeys/recovery.test.ts`_

- names the log path the code actually writes to
- names three things, and calls exactly one of them a cache
- writes a log line at the path it promised, for a real review

### deleting the database

_2 · `journeys/recovery.test.ts`_

- loses nothing that a rebuild does not put back
- stamps nothing new on the way back, because the notes already carry the ids

### what rebuilding does not fix

_2 · `journeys/recovery.test.ts`_

- leaves a deleted card out of the queue, but keeps its history
- warns in the same words the app's own dialog does

### what the guide says two machines need in order to agree

_3 · `journeys/moving-notes.test.ts`_

- gives each machine its own log file, so none is ever merged
- makes re-reading a log you already have a no-op, so a syncer may deliver it twice
- lets a machine that has never seen the collection catch up from the files alone

### the conflict copies the guide promises to leave alone

_2 · `journeys/moving-notes.test.ts`_

- recognises both shapes it names, and neither shape it says it will not
- leaves one alone in a real sync, and says that it did

### what the guide says belongs to a vault, and what to the machine

_1 · `journeys/vaults.test.ts`_

- shares exactly the rows it says belong to the machine

### where the guide says a new vault's database goes

_1 · `journeys/vaults.test.ts`_

- is the path it shows, and the first vault keeps the old one

### what switching costs, as the guide promises it

_1 · `journeys/vaults.test.ts`_

- reads no notes on coming back to a vault whose notes have not changed

### the folders the guide says are refused

_1 · `journeys/vaults.test.ts`_

- refuses and allows exactly the rows of its table

### what the guide says removing a vault keeps

_1 · `journeys/vaults.test.ts`_

- leaves its notes and log, so adding the folder again brings its history back

