# Reviewing

A session is one question at a time. Recall the answer, reveal it, and say how it went — and how it went is the only thing you are ever asked, because the schedule is derived from it.

It is the **Review** tab. Every key below is also a button, and they cannot disagree: one table in the code says what each key means, and the window draws from it rather than restating it. Anything here that says "press `3`" is true of the button marked `3 good` as well.

A card is shown where it sits, the way RemNote shows it: the note's name and the headings above it on a small line at the top, then the bullets it is nested under as an outline, with the question as the last bullet. A parent that is itself a card shows its answer too. So in `cells.md`,

```markdown
# Biology
- Cell
  - Nucleus >> holds DNA
    - Nucleolus >> makes ribosomes
```

`Nucleolus` is shown as

```text
cells › Biology
• Cell
   • Nucleus → holds DNA
      • Nucleolus
```

That is what lets a card deep in an outline have a short question. It shows the text from your last sync, like the card itself.

**Only the nearest three parents are shown in full.** Older ones fold into a `… 2 more` button, and a parent longer than two lines is cut short; click either to see the rest.

**A parent whose text appears in the answer is left out until you reveal it**, so it cannot give the answer away. RemNote does the same.

## The four ratings

Any key flips the card over. Then:

| | | |
|---|---|---|
| `1` | **forgot** | I could not recall it |
| `2` | **hard** | I got there, but it was a struggle |
| `3` | **good** | I recalled it |
| `4` | **easy** | Instant, and the interval could have been longer |

That is the whole vocabulary. There is no "mark known", no bury, no suspend.

Coming from Anki? `forgot` is the button Anki calls *Again*, and the other three have the same names there. The word is different because `1` is the only rating that counts as a failure, and *again* sounds like "show me this once more".

### When to press `hard` rather than `forgot`

This is the question every spaced-repetition user eventually asks, and it has a real answer: **did you produce the answer?**

- You produced it, slowly, with effort, maybe after a false start → `2 hard`.
- You did not produce it. You recognised it when you saw it, or nearly had it, or would have got it with one more second → `1 forgot`.

Recognising an answer is not recalling it, and the difference is the thing being measured. "I knew that really" after the answer appears is the most reliable feeling in all of studying and it is almost always wrong — this is *hindsight bias*, and it is exactly what a rating is supposed to see through. If you did not say it before you looked, it was `1`.

The two ratings do different things. `1` counts a **lapse** and sends the card back to the start; `2` keeps the card's history and shortens its next interval. Using `2` for cards you actually failed is the most common way to end up reviewing something for months without ever learning it: the schedule keeps stretching because you keep telling it you succeeded.

`4 easy` is worth being similarly careful with. It means *the interval was too short* — it pushes the next one out substantially. If the answer came instantly but the card felt about right, `3` is the honest key.

**Guessing correctly counts as `1`.** You want the schedule to describe your memory, not your luck.

## A card usually comes back in the same session

This surprises people, and it is the scheduler working rather than a bug.

A **new** card rated anything but `4 easy` is due again in **minutes**, not days:

| you press | a new card comes back in |
|---|---|
| `1` forgot | 1 minute |
| `2` hard | 6 minutes |
| `3` good | 10 minutes |
| `4` easy | 8 days — graduated, and gone for the session |

A card you have been reviewing for months, rated `1`, comes back in 10 minutes. So a session is not one pass through a list — a card returns when its time comes, and you answer it again, and only then does it move on to days.

Two things follow that you will see on screen:

- **The counter grows.** `3/23` becoming `3/24` is a second look being earned, not a miscount. The second number is *answers still owed*, and a card on a short step owes one.
- **A session of 23 cards is often 40-odd answers**, because cards you saw early in it come back before the end.

**A card is never shown before it is due.** When the only cards left are due a few minutes out, the session ends and says when they come back — `1 card comes back at 12:06`. A card shown again seconds after you rated it is a review the scheduler barely counts, and rating it `hard` there makes the scheduler think you remember it *less* well than before.

**Leave the window open and the finished screen offers them when they are due**: `1 due now`, and a **Review** button. It checks just after the time it named, every minute otherwise, whenever the window comes back to the front, and when you press **Check again**. The *Nothing due* screen does the same for cards that come due while the app is open — tomorrow's reviews, if you leave it running overnight. Neither ever starts a session by itself, so the tally of the one you just finished stays on screen until you choose.

A card you keep pressing `1` on keeps coming back, which is the point; `q` always works, and quitting is not a failure.

## `0 later` — the key for "not now"

Offered **only before you have seen the answer**, and it is the one action that records nothing at all: no rating, no history, no change to the card's schedule. The card moves to the back of the session and you will be asked again.

Use it when you have not attempted the card. Interrupted, distracted, someone spoke to you, or it is the kind of card that deserves attention you cannot give it right now. That is not a fact about your memory, so it is not recorded as one — and `1 forgot` would have been a lie the scheduler believes.

**It disappears once the answer is showing, on purpose.** Deferring a card whose answer you have just read would make the next sighting a sham: you would see it again with the answer fresh, rate it well, and the schedule would record a success you never earned. At that point the honest keys are the ratings — if you could not recall it, `1` already says so.

So `0` is not "show me this again for practice". It is "I have not answered this yet".

## `o` — open the note

Offered once the answer is showing. It opens the note the card lives in, at the card's line, so you can fix a typo, split a card that is doing two jobs, or read the paragraph around it.

**Choose an editor on the Vault screen if you want the line jump.** Under **Open notes in**, **System default** hands the file to whatever your system opens `.md` with, and none of those can be told a line number — so you get the note, from the top. The list also names each editor GeodeMD found installed that it knows how to put on a line — VS Code, Cursor, Zed, Sublime Text and their relatives — and picking one lands `o` on the card. If an editor you chose is later uninstalled, `o` says it was not found rather than quietly opening the note at the top.

**Other…** takes a command for anything not listed, such as `code -w`. One trap worth knowing: GeodeMD launches the editor and carries on rather than waiting, so a terminal editor like `vim` starts in a window you cannot type into. That is why none are listed; type one only if you wrap it in something that opens a terminal. See [`editor` in the configuration reference](../reference/configuration.md) for how a command is told the line.

GeodeMD does not wait for the editor to close — it launches it and carries on, so you can keep reviewing with the note open beside you. At the end of the session it names the notes that changed while you were reviewing, because the cards on screen came from the last sync: **an edited note needs a sync** before the change reaches your queue.

### Reading the note without leaving the review

Most of the time `o` is for reading the paragraph around a card, not for fixing it, and another app taking focus is heavy for that. Tick **Read notes inside GeodeMD first** on the Vault screen, under **Open notes in**, and `o` shows the note in the review window instead — rendered, scrolled to the card, with the card's line highlighted. It is **read-only**.

While the note is showing, **the review keys do nothing**: `3` does not rate the card behind it, `q` does not quit, and `a` does not open the annotation. The arrow keys, Space and Page Down scroll the note. Three keys mean something:

| | |
|---|---|
| `o` | back to the card |
| `Escape` | back to the card |
| `e` | open in editor |

Back at the card, everything is as you left it — the same card, the answer still showing. `e` opens the note in the editor chosen under **Open notes in**, at the card's line where that editor can be told one — the same thing `o` does with the box unticked — for when reading turns into fixing.

What you see is the note **as it is on disk now**, and the card is from the last sync. If the note has been edited since, the card is looked for by its id rather than its old line number: if it moved, it is highlighted where it is now and a line above the note says so; if it is not in the note any more, nothing is highlighted and that line says why. Links in a note open in your browser; images are not shown yet.

## `a` — annotate the card

Offered once the answer is showing. It opens a box under the answer for what reviewing this card taught you: a mnemonic, why you keep mixing it up with another card, a source, an example. What is already written there is in the box when it opens.

**Never before the answer.** An annotation is free to give the answer away, so at the question `a` does nothing — it does not even reveal the card the way other keys do. When a card has an annotation, a small line under the answer says so; the annotation itself stays hidden until you press `a`.

While the box is open, **everything you type is text**. `3` is part of "3 seconds", not a rating, and `q` is a letter, not a quit. Two keys close it, and **both save**: `Escape`, and ⌘↵ (Cmd+Enter). There is no key that closes without saving — losing what you typed would be the worse surprise — and leaving the Review tab or switching vault with the box open saves it as well. Emptying the box and closing it removes the annotation.

If a save fails, the box stays open with your text in it and says why, so nothing you typed is lost.

**Annotations are plain text files in your notes folder**, one per card: `.sr/annotations/<card-id>.md`, named by the id stamped on the card's line. So they are carried wherever your notes folder goes, and sync with it, like your review history. Two things follow:

- **Obsidian does not show them.** It hides folders whose names start with a dot, and `.sr` is one. Any editor that shows hidden folders can open them; they are ordinary Markdown.
- **Deleting a card keeps its annotation.** The file stays behind, and if the card comes back — restored from a backup, or the line undone — its annotation comes back with it. A card you copy gets a new id, so the copy starts with none.

## Quitting, and what is saved

`q` quits, from the question or the answer. So does `Escape` — except while an annotation is open, where it saves and closes the box instead, and while a note is showing, where it goes back to the card — and so does Ctrl-C.

**Every rating you have already given is saved.** Each one is written to the review log and flushed to disk before anything else happens, so quitting, closing the window, a crash, or a dead battery costs you nothing but the cards you had not answered yet. There is no "end session" step and nothing to commit.

If a session says `database busy` and keeps going, that is the same mechanism showing through: your rating is in the log, and the database catches up by itself. Nothing is lost, though a card that would have come back in ten minutes will wait until next time.

## What a session shows you, and what it does not

**Which cards you get.** Cards that are due, most overdue first, then cards never reviewed, in the order they read in your notes. Nothing is randomised.

**A backlog fills the session.** Ask for 50 cards with 400 due and you get 50 due cards and no new ones. That is deliberate — recovering what you half-know beats piling on more — and `-n` is the way out if you disagree.

**No daily limit, and no "done for today".** A session is as long as you ask for. Nothing is being withheld, and nothing is being counted against you.

**A deleted card can still turn up.** `review` deliberately does not walk your notes — that is what keeps a session instant on a large collection — so a note you deleted since the last sync leaves its cards in the queue until you sync.

The counter on each card (`3/24`) and the count of what the session was drawn from (`12 of 400 due`) are the whole of the progress reporting. At the end you get a tally of the ratings you gave, and the names of any notes you edited.
