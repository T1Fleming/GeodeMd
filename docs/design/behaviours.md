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

900 behaviours in 13 areas, which follow [the guides](../guides/) rather than the source tree.

- [Reviewing](#reviewing) — 235
- [Recognising a card](#recognising-a-card) — 129
- [Exercises](#exercises) — 59
- [Syncing notes](#syncing-notes) — 89
- [Recovery and the log](#recovery-and-the-log) — 59
- [Moving between machines](#moving-between-machines) — 17
- [Keeping several vaults](#keeping-several-vaults) — 60
- [Setting up this machine](#setting-up-this-machine) — 85
- [The app's long runs](#the-apps-long-runs) — 32
- [The database as a cache](#the-database-as-a-cache) — 7
- [At scale](#at-scale) — 9
- [Rules the project enforces on itself](#rules-the-project-enforces-on-itself) — 36
- [The documentation tells the truth](#the-documentation-tells-the-truth) — 83

## Reviewing

_A session: which card is next, what the keys mean, what a rating records, and what comes back before the sitting ends._

**235 behaviours.**

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

_5 · `core/review.test.ts`_

- writes the log BEFORE SQLite
- omits elapsed and scheduled on a first review, and includes them after
- recovers a review that reached the log but not the database
- puts a lapsed card back within minutes, not the same session
- keeps a card's learning step between ratings, so a second good graduates it

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

_4 · `host/queue.test.ts`_

- never shows a waiting card before it is due
- says when the soonest of several waiting cards is due
- has no next due time when nothing is waiting
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

_8 · `host/present.test.ts`_

- names all four FSRS ratings, in order
- agrees with interpretKey about every key it advertises
- gives the note viewer its own keys, and none of the review's
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

### what is shown above a question

_8 · `host/present.test.ts`_

- puts the note and its headings on the path line, and the bullets in the outline
- is just the note's name for a card with nothing above it
- shortens a long path segment on its own
- does not shorten a parent bullet, which is cut by lines instead
- shows the nearest 3 parents and folds the older ones
- leaves out a parent whose text is in the answer until the answer shows
- leaves a spoiler out before folding, so the nearest parents that can be shown are
- never treats a heading as a spoiler, nor whitespace as text

### what the app says when the card syntax changed

_1 · `host/present.test.ts`_

- names both separators, the one that stopped, and the preview

### what the app says about card lines that are not nested

_3 · `host/present.test.ts`_

- says nothing when there are none
- names where they are, why, and the fix
- says how many more there are than it names

### what the app says about cards not due yet, and cards due now

_2 · `host/present.test.ts`_

- names how many cards come back, and at what time
- counts cards due now, as a floor when the count stopped at the cap

### what an erase says it will remove

_3 · `host/present.test.ts`_

- counts id comments, notes and what .sr/ holds
- says so when there is nothing to take out, and no .sr/
- warns that unreadable notes will stop it

### how a spot review is worded and offered

_6 · `host/present.test.ts`_

- names its ratings by what happened, with the same four keys
- offers no annotation, having no stamp to name one by
- keeps the note's path hidden until the answer, since a folder can name the skill
- says a repeat's pool has run out, and what to do about it
- measures 'served today' from the start of the local day
- counts spot reviews into the backlog's cap

### what a sync summary says about exercises

_3 · `host/present.test.ts`_

- says nothing about exercises in a vault that has none
- counts the exercises found and the ones it could not serve
- names the notes it left out, and the fix

### how the Practice screen is worded and keyed

_7 · `host/present.test.ts`_

- names the solve ratings by what happened, with the same four keys
- starts and pauses on Space, shows the solution only on d, and offers leave at both stages
- says whether the clock has started, and whether it is running
- shows the clock as m:ss, and h:mm:ss past the hour
- says when a skill comes back as a date
- lists the rest of the pool, then who shares each other skill
- tallies spot reviews in their own words, after the cards

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

_6 · `electron/renderer/model/session.test.ts`_

- comes back in the same session
- goes ahead of a card that has not been seen yet, once it is due
- does not replace the card being read the moment it ripens
- is answered again once due, and counted again
- makes the counter's denominator grow, because a second answer is owed
- keeps the session alive while the rating is in flight

### a session whose only cards left are not due yet

_7 · `electron/renderer/model/session.test.ts`_

- ends for now rather than showing one early
- says when the first of several comes back
- has nothing coming back when every card graduated
- is stopped early, not resting, when the user quit
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

_15 · `electron/renderer/model/session.test.ts`_

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
- lets a vault switch go ahead only once an open box has saved
- refuses the vault switch when that save fails, keeping the text and the error
- ignores an annotation that arrives for a card no longer on screen

### reading the card's note inside the app

_11 · `electron/renderer/model/session.test.ts`_

- shows the note with `o` rather than spawning an editor, when that is the choice
- still hands the note to an editor when the viewer is not the choice
- reveals with `o` at the question, as before, rather than showing the note
- gives the rating keys, q, 0 and a no effect while the note is showing, or on its way
- goes back to the same card at the same stage on Escape, or on `o` again
- hands the note to an editor on `e`, back at the card, and remembers it was opened
- does not open the note over the card after Escape, when the read answers late
- goes back to the card when the read fails
- does not open the note while annotating — `o` is text there
- does not open the annotation while the note is showing
- lets the keys it does not use through to the page, so the note can scroll

### a spot review in the session

_5 · `electron/renderer/model/session.test.ts`_

- is revealed and rated like a card, and the rating carries the spot review
- asks for no annotation on the reveal, having no stamp to name one by
- ignores `a`, because a spot review has no annotation
- does not come back in the sitting: a skill has no short-term steps
- opens the exercise's note whole, with no line to find

### a session's tally keeps spot reviews apart

_1 · `electron/renderer/model/session.test.ts`_

- counts a spot review's rating apart from a card's, and both as reviewed

### when a screen with no card checks for cards coming due

_5 · `electron/renderer/model/idle.test.ts`_

- checks every regular interval when it knows no due time
- wakes just after a known due time inside the next interval
- wakes after, never on, a due time exactly one interval away
- checks at the regular interval when the due time is further off
- falls back to the regular interval once the due time has passed, never zero

### what a check offers

_3 · `electron/renderer/model/idle.test.ts`_

- starts only one check at a time
- offers cards that are due, and nothing when none are
- keeps what it showed when a check fails, and lets the next one start

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

### the note's Markdown as the viewer renders it

_7 · `host/note.test.ts`_

- marks the card's line, and only that line
- marks after a list marker or task box, so the list still renders as one
- shows no stamp anywhere, on the card's line or any other
- drops frontmatter, which would render as a rule and a heading made of YAML
- keeps each line's own terminator, so a CRLF note keeps its line numbers
- marks nothing when the card was not found
- refuses a marker id that could break out of the attribute

### what the viewer says about where the card is

_3 · `host/note.test.ts`_

- says nothing when the card is where the last sync left it
- says so when the note changed and the card moved
- says so, rather than pointing at the wrong line, when the card is gone

### reading a card's note for the viewer

_4 · `electron/main/note.test.ts`_

- returns the note as it is on disk, and the card's line in it
- finds the card by its stamp when the note has been edited since the sync
- has no line for a card that is no longer in the note, rather than a wrong one
- says the note has gone, as a result rather than a throw

### a note read is confined to the notes folder

_3 · `electron/main/note.test.ts`_

- refuses a stored `..`, however it is spelled
- resolves before it checks, so a path that only wanders inside is fine
- is refused for a vault that is no longer open

### a card's annotation

_7 · `files/files.test.ts`_

- is null for a card that has none, and reads back what was written
- is replaced whole by a second write
- is removed by empty or blank text rather than left as an empty file
- refuses an id that is not a stamp, before it becomes a path
- leaves no partial or temporary file behind, whether the write succeeds or fails
- comes back byte-identical, CRLF and missing final newline included
- is never walked as a note, so a ` >> ` inside one is not a card

## Recognising a card

_Text in, cards out. Also — and mostly — the shapes that are deliberately NOT cards, because a false positive writes a stamp into someone's note._

**129 behaviours.**

### the basic form

_3 · `parser/parser.test.ts`_

- splits on the first separator and trims both sides
- reports a 0-based lineIndex
- finds multiple cards in one document

### `>>` and `==` both make a forward card

_4 · `parser/parser.test.ts`_

- Q >> A
- Q == A
- - Covalent bond == a shared pair of electrons
- splits on whichever separator comes first

### a separator without whitespace on both sides is not a separator

_5 · `parser/parser.test.ts`_

- foo>>bar
- a ==b
- a== b
- x<<y >>z
- key::value in a field

### a backslash keeps a separator literal

_4 · `parser/parser.test.ts`_

- x \== y
- a \>> b
- - if x \== y then stop
- still splits on an unescaped separator later in the line

### `::` is not a card

_2 · `parser/parser.test.ts`_

- Mitochondria :: produce ATP
- - Q :: A <!-- sr-a7Kd9mQ2xR4v -->

### RemNote's other tokens are not forward cards

_9 · `parser/parser.test.ts`_

- Q >>> A
- Q >>- A
- Q ==- A
- Q ==A) A
- Q >>A) A
- Q >>1. A
- Q << A
- Q <> A
- Q ;; A

### a later separator is answer text

_1 · `parser/parser.test.ts`_

- keeps `>>` in the answer — one line is always at most one card

### leading list markers are stripped from the question

_9 · `parser/parser.test.ts`_

- - Q >> A
- * Q >> A
- + Q >> A
- 1. Q >> A
- 12. Q >> A
- 1) Q >> A
- - [ ] Q >> A
- - [x] Q >> A
-   - Q >> A

### an empty side is not a card

_5 · `parser/parser.test.ts`_

- " >> A"
- "Q >> "
- " >> "
- "- >> A"
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

### bullets nested under other bullets are cards at any depth

_6 · `parser/parser.test.ts`_

- reads a card four spaces deep under a parent bullet
- reads a card a tab deep under a parent bullet
- reads cards several levels deep, with tabs and spaces mixed
- reads nested ordered items and task boxes
- keeps the list open across blank lines between items
- returns to a shallower level after a deep one

### indented code near a list stays skipped

_8 · `parser/parser.test.ts`_

- skips a marker line indented four or more columns past its parent's text
- skips indented lines that are not bullets, even inside a list
- skips an indented bullet once a paragraph has ended the list
- skips an indented bullet once a heading has ended the list
- skips an indented bullet once a fence at the margin has ended the list
- does not mistake a horizontal rule for a bullet
- skips an indented bullet with no list above it
- leaves every shallower line as it was

### a card's context is the headings and bullets above it

_16 · `parser/parser.test.ts`_

- is the parent bullets, outermost first, under the headings
- is empty for a card with no heading or bullet above it
- gives a card outside a list the headings above it
- replaces a heading with the next one at its level, and clears deeper ones
- skips a level that was never opened
- strips a closing sequence, comments and stamps from what it shows
- shows only the term of a `::` ancestor, as a Concept card would
- drops a bullet that leaves the list, and a sibling is not a parent
- drops the list at a heading
- keeps a parent across blank lines between items
- leaves out an empty bullet
- does not take a heading in a fence
- does not take a heading in a blockquote
- does not take a heading in frontmatter
- does not take a tag, which is not a heading
- does not take a heading inside a list item

### tabs nest like spaces, and only list items nest

_4 · `parser/parser.test.ts`_

- gives a tab-nested card its parent bullets
- gives a continuation line its bullet as a parent
- skips a tab-indented line under a bullet when it is not a bullet itself
- skips a tab-indented bullet under a line that is not a bullet

### card-shaped lines indented without a list marker are reported

_10 · `parser/parser.test.ts`_

- names a line indented under text, which Markdown reads as more of that text
- names one under a bullet, and one indented too deep under a bullet
- does not name an indented code block, which follows a blank line
- does not name a line indented under a fence
- does not name a line indented under a heading
- does not name a line indented under a table
- does not name a line indented under a blockquote
- does not name a line indented under frontmatter
- names nothing that is not card-shaped
- finds the same cards as parse

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

### taking every stamp out of a note

_8 · `parser/parser.test.ts`_

- gives back the line exactly as it was before it was stamped
- keeps every line terminator, CRLF and a missing final newline included
- finds a stamp a user typed after, and two on one line
- finds stamps on lines that are no longer cards
- leaves another comment alone
- leaves an id one character short alone
- leaves an id with a character it cannot hold alone
- leaves an id without its prefix alone

## Exercises

_Notes opted in by `geode-skills`: a skill scheduled in place of a card, and a different problem from its pool served each time it comes due (ADR 0038)._

**59 behaviours.**

### a note becomes an exercise only by naming its skills

_6 · `parser/exercise.test.ts`_

- reads the skills, the title, and the statement up to ## Solution
- is an ordinary note without properties, without geode-skills, or with an empty list
- ignores form, so a user's own form: exercise makes nothing an exercise
- reads a block list as well as a flow list, trimmed and without repeats
- reads only the properties block on line 1, not a geode-skills line in the body
- keeps CRLF out of what it reads

### an exercise that cannot be read is reported, not guessed at

_3 · `parser/exercise.test.ts`_

- is unreadable when the properties do not parse
- is unreadable when geode-skills is not a list of non-blank strings
- is left out of every pool without ## Solution, so a spot review cannot show the solution

### where an exercise's statement ends

_7 · `parser/exercise.test.ts`_

- matches ## Solution in any case, with trailing spaces or closing hashes
- ends at a heading that gives the answer away, above ## Solution
- keeps the problem's own sections, like ## Examples, in the statement
- still needs ## Solution when a spoiler heading ends the statement
- does not end at a ## Solution inside a fenced block
- starts straight after the properties when the note has no title
- leaves ordinary cards in an exercise note to the card parser

### sync reads a note's skills into pools

_6 · `core/exercises.test.ts`_

- puts an exercise in every pool it names, and writes nothing into the note
- titles an exercise with no heading by its file name
- reports an exercise it cannot serve, and leaves it out of every pool
- takes a note out of its pools when the property or the heading goes, or the note does
- previews without writing a row
- re-reads every note once when the exercise rules change, so an untouched note is found

### which exercise a skill is served with

_3 · `core/exercises.test.ts`_

- prefers one not served today, then one fresh to this skill, then the least recent, then by path
- counts one already chosen in this sitting as served today
- makes the worked example's nine picks, in order

### a spot review is in the sitting, asked with an exercise from the pool

_6 · `core/exercises.test.ts`_

- mixes spot reviews in among the due cards, and serves new cards after both
- carries the title, the statement and every skill, and nothing that names the skill asked
- never puts one exercise in a sitting twice for two skills that share it
- never makes a skill with an empty pool due, and keeps its schedule for when it fills
- brings a skill back in days, never minutes, whatever the rating
- counts skills due for a spot review in the stats, capped like every other count

### skill reviews in the log

_5 · `core/exercises.test.ts`_

- records a spot review in the log before the database, as a card's is
- reads skill reviews another device wrote
- skips a malformed skill line as it skips a malformed card line
- reads again, once, the lines an older build skipped and moved past
- re-derives skill schedules when the skill scheduler changes

### the Practice screen offers one solve at a time

_6 · `core/exercises.test.ts`_

- offers the skill whose solve is most overdue, with an exercise picked by the same rules
- is null when no skill is due for a solve
- does not count a spot review against a solve: a spot shows no solution
- counts a solve against every skill: a solved problem is not new to any of them
- calls a solved problem a repeat when it is all a pool has left
- counts skills due for a solve in the stats

### spot reviews are mixed in, in an order that gives nothing away

_3 · `core/exercises.test.ts`_

- orders them by skill and day, not by name: the same all day, different tomorrow
- spreads them evenly through the due cards, keeping the cards' own order
- serves them on their own when no card is due

### the exercises shown beside one once it is answered

_2 · `core/exercises.test.ts`_

- lists the rest of the pool, and who shares each of its other skills
- leaves out another skill that no other exercise shares

### a solve on the Practice screen

_12 · `electron/renderer/model/practice.test.ts`_

- waits for Space to start the clock, so reading the problem is not solving it
- pauses and resumes on Space, counting only the time it ran
- shows the solution only on d, never on Space, so the reflexive key cannot give it away
- finishes from a clock that never started, and records no time rather than none spent
- hides and shows the clock on h, which changes nothing about the solve
- records the rating with the time taken, and offers no second solve
- keeps the solve when a rating fails, so it can be given again
- records nothing when you leave, before or after the reveal
- ignores Escape, which would throw away a solve by reflex
- picks a solve under way back up on return to the tab, and nothing finished
- opens the note in an editor once the solution is showing, and not before
- drops a note that arrives after the rating

## Syncing notes

_Finding what changed, stamping it, pruning what is gone, and saying what happened._

**89 behaviours.**

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

### a card's context follows its note

_2 · `core/sync.test.ts`_

- is stored when the card is found
- changes when a parent is edited, without the card's own line changing

### a change of card syntax

_4 · `core/sync.test.ts`_

- makes the next sync read every note, once
- is not reported for a vault that has never synced
- is still owed after a preview, which records nothing
- drops cards written with `::`, keeping their history for when the line comes back

### a change of how context is derived

_3 · `core/sync.test.ts`_

- makes the next sync read every note once, without reporting a syntax change
- is still owed after a preview
- draws a parent stored before `kind` existed as a bullet

### card lines that are not nested

_2 · `core/sync.test.ts`_

- are counted and located by a sync, and by a preview, without becoming cards
- name only the first ten, and count them all

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

### the reset marker and the log archive

_4 · `files/files.test.ts`_

- has no reset time until one is written, then reads it back
- refuses a reset time not in the log's own format
- moves nothing, and makes no archive, when there is no log
- moves only shards, byte for byte

## Recovery and the log

_The append-only review log, and rebuilding the database from nothing but notes and logs._

**59 behaviours.**

### what the app says when due dates were worked out again

_1 · `host/present.test.ts`_

- says how many, and that the notes and the log were not touched

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

- reproduces cards, files, reviews, card_state and every skill table IDENTICALLY, in full
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

### a database scheduled by a different scheduler

_6 · `core/rebuild.test.ts`_

- re-derives every schedule to exactly what a rebuild produces
- records the scheduler, so the next open does nothing and writes nothing
- reaches the schedule of a card whose line is gone, so a restored card comes back right
- says nothing about a new database, and records the scheduler all the same
- leaves the old scheduler recorded until the last schedule is re-derived
- is recorded by a rebuild, which derives everything with the scheduler running

### a database from before FSRS-6

_1 · `core/rebuild.test.ts`_

- opens, gains the column, and has every schedule re-derived

### starting a vault fresh

_11 · `core/fresh.test.ts`_

- makes every card new, with no history and no schedule
- edits no note and keeps every annotation
- moves the log whole into a dated archive, leaving the log empty
- records reviews made after it as usual
- ignores a review from before it, even when its shard comes back
- is followed by another device sharing the folder, on its next sync
- is finished by the next sync when it stopped after the marker
- is undone by moving the log back and removing the marker
- is left alone by a preview, which writes nothing
- does not report a change of card syntax
- refuses a marker that does not say when, rather than ignoring it

### the scheduler is FSRS-6, pinned

_5 · `scheduler/scheduler.test.ts`_

- names the ts-fsrs that package.json pins, exactly, and the one installed
- runs the 21 weights it writes down — FSRS-6's defaults, neither padded nor clipped
- leaves ts-fsrs nothing to fill in, and so nothing to log
- pins the short-term steps ADR 0023's same-sitting re-show is built on
- calls itself by the library and every parameter, so changing either is noticed

### fuzz spreads due dates, and every replay draws the same fuzz

_5 · `scheduler/scheduler.test.ts`_

- draws the same schedule from the same history, every time
- draws the same schedule replaying from a midpoint as from the start
- parts cards rated alike at the same moments onto different days
- never moves a short-term step
- draws exactly these dates, so a change in the library's fuzz is noticed

### opening a vault another scheduler scheduled

_3 · `electron/main/active.test.ts`_

- re-derives its schedules before handing it over, and says so once
- opens one Store however many reads arrive at once
- closes a half-opened vault that a switch overtook, rather than keeping its Store

## Moving between machines

_One notes directory, two devices, no built-in sync transport._

**17 behaviours.**

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

### the queue holds spot reviews

_1 · `electron/main/reads.test.ts`_

- serves a skill due for a spot review beside the cards, and drops it once answered elsewhere

## Keeping several vaults

_Several notes folders, each with its own database, one open at a time — adding, switching, and the overlap that would split a card's history._

**60 behaviours.**

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

### erasing GeodeMD's stamps from a vault

_4 · `core/erase.test.ts`_

- leaves the demo notes byte for byte as they were before a sync
- finds stamps sync no longer reads: old `::` lines, code and conflict copies
- writes nothing on a dry run, and says what it would take out
- leaves a note with no stamp untouched, mtime included

### removing a vault from the app

_2 · `electron/main/removal.test.ts`_

- leaves its notes and .sr/ alone, and deletes its database when asked
- closes the open vault first, and opens the one left

### erasing GeodeMD from a vault

_5 · `electron/main/removal.test.ts`_

- previews what it would take out, writing nothing
- refuses without the vault's name typed, and changes nothing
- takes out every stamp, deletes .sr/ and the database, and drops it from the list
- does nothing at all when the open vault cannot be closed
- leaves first-run setup behind when it was the last vault, keeping this machine's name

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

_3 · `electron/renderer/model/vaults.test.ts`_

- says which vault opens next when the open one goes
- says nothing for a vault that is not open
- says setup comes back when the only vault goes

### confirming an erase

_1 · `electron/renderer/model/vaults.test.ts`_

- needs the vault's exact name, spaces at either end aside

### notes edited in the vault just left

_2 · `electron/renderer/model/vaults.test.ts`_

- names the vault, since its notes are no longer the ones on screen
- says nothing when nothing changed, or nothing was open

### keeping a list of vaults

_14 · `host/host.test.ts`_

- gives an added vault its own database, and makes it the open one
- shares device and editor across vaults, since both are about the machine
- uses the id the proposal showed, and replaces one that is malformed or taken
- names two vaults apart even when their folders share a name
- refuses to add a vault that overlaps one already in the list
- switches by changing only which vault is active
- renames a vault without moving anything, and refuses a blank or taken name
- removes the open vault, and opens the first one left
- removes the last vault, leaving first-run setup that keeps this machine's name
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

**85 behaviours.**

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

### hiding the Practice clock

_3 · `host/host.test.ts`_

- is remembered as its own key, beside the others
- removes the key when shown again, and is on only for a literal true
- is null when there is no config to set it in

### choosing to read notes inside the app

_5 · `host/host.test.ts`_

- is its own key, and leaves the chosen editor where it was
- removes the key when turned off, rather than writing false
- is on only for a literal true, so a hand-edited string does not replace the editor
- survives re-pointing the vault, like the editor
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

**32 behaviours.**

### single-flight

_4 · `electron/main/runs.test.ts`_

- a second sync JOINS the first rather than failing
- a rebuild cannot join a sync
- a fresh start cannot join a sync, and nothing joins a fresh start
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

**36 behaviours.**

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

_3 · `boundaries.test.ts`_

- shows every sentence host writes about a sync
- nothing below the interfaces imports electron
- keeps onProgress out of the wire types

### the packaged app carries what the main process imports

_1 · `boundaries.test.ts`_

- lists every root dependency in desktop/package.json, at the same version

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

**83 behaviours.**

### the demo collection

_2 · `demo.test.ts`_

- holds the number of cards its README advertises
- is unstamped, so a reader sees what they would write themselves

### syntax.md keeps its promises

_6 · `demo.test.ts`_

- skips every shape it demonstrates
- reads neither an escaped separator nor `::`
- does not read the inline code span as a card
- strips list markers and task boxes from the question
- strips a trailing comment that is not a stamp
- keeps a later separator as answer text

### the examples the guide shows a reader

_8 · `journeys/first-sync.test.ts`_

- shows a stamped line that really is one
- shows three shapes that are cards, and they all are
- is right that a nested bullet is a card at any depth
- is right that only list items nest, and that the RemNote-style outline is one card
- is right that `a>>b` is not one
- is right that a backslash keeps a separator literal
- is right that ` :: ` is not a card
- is right about every context it says is skipped

### looking before it writes

_2 · `journeys/first-sync.test.ts`_

- writes nothing on a dry run — not a stamp, not a database row
- reports the two numbers the guide tells a reader to compare

### the real sync

_2 · `journeys/first-sync.test.ts`_

- edits every file that contains a card, and only those
- leaves a second run with nothing to do, so the edit happens once

### moving cards off ` :: `

_2 · `journeys/first-sync.test.ts`_

- keeps a card's id, and so its history, through the guide's command
- previews how many lines stop being cards before anything is written

### a card is shown under its parents as the guide draws it

_3 · `journeys/reviewing.test.ts`_

- lays out the guide's example as the guide shows it
- folds all but the nearest three parents, as it says
- leaves out a parent that is in the answer until the answer shows, as it says

### the guide's four ratings are the four the app honours

_4 · `journeys/reviewing.test.ts`_

- names the same keys, in the same order, with the same words
- advertises no key that does nothing
- puts `0` and `o` at the stages it says they are offered at
- offers the editors it says `o` can put on a line, and no terminal ones

### reading the note inside the app does what the guide says

_4 · `journeys/reviewing.test.ts`_

- offers the three keys in its table, and they do what the table says
- gives the review keys nothing to do while the note is showing
- is a setting of its own, so `e` still opens the editor chosen under Open notes in
- finds the card by its id when the note has changed, and says so rather than highlighting the wrong line

### the intervals the guide quotes are the ones FSRS produces

_3 · `journeys/reviewing.test.ts`_

- matches every row of the table, against the real scheduler
- is right that a card is never shown before it is due, and the finished screen says when
- is right that a long-standing card rated `1` comes back in ten minutes

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

### a problem taken apart into cards works as the guide says

_4 · `journeys/reviewing.test.ts`_

- reads every line of the signals example as a card, and shows nothing above one that gives it away
- is right that a note's name is shown above its cards even when it is the answer
- reads the method example as cards, in a note named after the technique
- is right that a solution in a code block beside the cards is not read as cards

### an exercise is asked as the guide says

_10 · `journeys/reviewing.test.ts`_

- asks the guide's example as the guide draws it, and writes nothing into the note
- names the same four ratings, in the same order, with the same words
- asks a skill with a different exercise each time it comes due
- is right that only geode-skills makes an exercise, and form: exercise does not
- leaves out a note with no ## Solution, and the summary names it
- is right that the statement ends sooner at a heading that would give the answer away
- is right that a skill comes back in days, never minutes, whatever you press
- is right that a problem you have solved is used up for every skill it is tagged with
- is right that spot reviews are mixed in among the due cards
- says what it says when a skill has run out of exercises, and offers no annotation

### a solve on the Practice tab goes as the guide says

_3 · `journeys/reviewing.test.ts`_

- names the same four solve ratings, in the same order, with the same words
- offers one solve, times it, and records the time beside the rating
- is right that Space starts and pauses, only d stops the clock, and q leaves having recorded nothing

### what the guide says is durable, and where it says it lives

_3 · `journeys/recovery.test.ts`_

- names the log path the code actually writes to
- names four things, and calls exactly one of them a cache
- writes a log line at the path it promised, for a real review

### deleting the database

_2 · `journeys/recovery.test.ts`_

- loses nothing that a rebuild does not put back
- stamps nothing new on the way back, because the notes already carry the ids

### what rebuilding does not fix

_2 · `journeys/recovery.test.ts`_

- leaves a deleted card out of the queue, but keeps its history
- warns in the same words the app's own dialog does

### starting a vault fresh

_3 · `journeys/recovery.test.ts`_

- makes every card new without editing a note, as the guide says
- archives the history where the guide says, and is undone the way it says
- says in the guide what the app's own dialog says

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

### erasing GeodeMD from a vault's notes

_2 · `journeys/vaults.test.ts`_

- leaves the notes exactly as they were before GeodeMD, and no .sr/
- can remove the only vault, and setup after it keeps this machine's name

