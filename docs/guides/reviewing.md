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
      • Nucleolus → ?
```

**The line being asked ends in a highlighted `?`**, and the answer appears in its place when you reveal it. A parent that is a card shows its answer, so the `?` is what tells you which line the question is.

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

## Practising problems, not facts

Some things worth practising are not facts: a LeetCode problem, a system design question, a proof. **Don't put the whole problem on one card**, like `Daily Temperatures >> use a monotonic stack`. It fails in three ways:

- **It trains the wrong thing.** After two reviews you remember that *this* problem uses a stack. The point was to recognise a stack problem you have never seen, and the card stopped measuring that.
- **Rating it measures familiarity.** You read the answer, it looks familiar, and you press `3`. Familiar is not the same as able to do it.
- **The answer doesn't fit on a line.** A solution is a page, and a card is one line.

Two things work instead, and they work together. Make each problem an **exercise**, and GeodeMD asks you which skill it calls for, on a different problem each time. And take a problem apart into cards about the **method**, so the method stays fresh between problems. Neither replaces solving new problems yourself.

### Exercises: a different problem each time

Give each problem its own note, and add a `geode-skills` property at the top listing the skills it practises:

```markdown
---
geode-skills: [monotonic-stack]
source: https://leetcode.com/problems/daily-temperatures/
---
# Daily Temperatures

Given daily temperatures, return for each day how many days until a warmer one.

## Solution

Keep a stack of indices still waiting for a warmer day, and pop them as warmer days arrive.
```

That makes the note an **exercise**, and `monotonic-stack` a **skill**. GeodeMD schedules the skill, not the note. When `monotonic-stack` comes due, your session shows one of the exercises tagged with it and asks:

```text
Daily Temperatures

Given daily temperatures, return for each day how many days until a warmer one.

Which skill does this call for? → ?
```

**Each time the skill comes due, it is asked with a different exercise**, the one it was asked with least recently. Remembering that *this* problem used a stack doesn't get you through the next review, because the next review is a different problem. Reveal, and every skill the exercise is tagged with replaces the `?`. **Naming any of them counts as right.** Then:

| | | |
|---|---|---|
| `1` | **wrong skill** | You named a skill it isn't tagged with, or none |
| `2` | **right, after hesitating** | You got there, but not straight away |
| `3` | **right** | You named it |
| `4` | **right, at once** | You knew before you finished reading |

What makes it work:

- **Only `geode-skills` makes a note an exercise**, and it has to be a list, like `[two-pointers, greedy]`. Every other property is yours: `tags`, or a `form: exercise` you filter by, mean nothing to GeodeMD. In Obsidian, `geode-skills` is a list property you edit in the Properties panel.
- **The statement ends at `## Solution`, or sooner at a heading that would give the answer away:** `## Intuition`, `## Approach`, `## Hint` or `## Hints`, and `## Explanation`. A review shows the title and everything after it up to that heading, and nothing else: no path line, no tags. Sections that belong to the problem, like `## Examples`, stay in. A note with `geode-skills` but no `## Solution` heading is left out, and the sync summary names it. Otherwise a review would show your solution.
- **Nothing is written into the note.** An exercise gets no id comment.
- **Don't put the skill in the title.** "Daily Temperatures (monotonic stack)" answers the question before it is asked. The note's path is fine: it stays hidden until you reveal.
- **Tag only the skills the note genuinely uses.** Since any tag counts as right, a note with two tags tests each of them less well.
- **A skill comes back in days, never minutes**, whatever you press. Re-asking a problem a minute later would test nothing but the minute.
- **One problem is not asked twice in a day** for two different skills, as long as either skill has another exercise.
- **A problem you have solved is used up** for every skill it is tagged with, for spotting and solving alike: you have read its solution, so it is no longer new to any of them. Spotting a problem doesn't use it up for solving, since a spot review shows no solution.
- **When every exercise for a skill has been asked or solved**, the least recent is asked again, and the reveal says `You have seen every exercise for greedy. Add one to its pool.` Add a note, and the next review asks it.

`o` opens the exercise's note once the answer is showing. `a` is not offered: annotations are for cards. Once the answer is showing, the review also lists the other exercises for the skill, and the ones that share the exercise's other skills. Seeing problems with the same structure side by side, especially ones that look nothing alike, is how you learn to recognise it.

### Solving: the Practice tab

Recognising the skill is half of it. The other half is carrying it out, and that is the **Practice** tab. It offers **one solve per visit**: the skill whose solve is most overdue, with an exercise picked the same way a spot review's is. Spotting a skill and solving it have separate schedules, and a skill you have spotted with one exercise can still be solved with it, since spotting it showed you no solution.

A clock starts when the problem appears. Solve it wherever you solve things, in an editor or on LeetCode, and come back. **Press Space when you are done**, or Enter. No other key stops the clock, so a stray keypress half an hour in shows you nothing. The clock stops, and your note opens in full, solution and all, with the related exercises under it. Then:

| | | |
|---|---|---|
| `1` | **couldn't solve it** | You gave up, or your answer was wrong |
| `2` | **solved with help** | You looked something up, or peeked at your note |
| `3` | **solved on my own** | No help |
| `4` | **solved on my own, easily** | No help, and it came without a struggle |

`1` and `2` are facts: you finished or you didn't, and you peeked or you didn't. The difference between `3` and `4` is your judgement. There is no time limit deciding it, but the time each solve took is recorded beside its rating.

`q` leaves without rating, before or after the solution is showing, and records nothing: the solve is still due next time. A solve survives a visit to another tab: come back and it is where you left it, with the clock still running. Only `q` leaves; Escape does nothing here, so a reflex can't throw half an hour away. `o` opens the note in your editor once the solution is showing. After a rating, the tab says when the skill comes back and offers nothing more until your next visit. A solve takes half an hour, and a queue of them would make a sitting impossible to plan.

### Cards for what gives the method away

The most useful card is the one you need in an interview: **what in a problem tells you which technique to use.** Write the signal in general terms, with no problem's name in it:

```markdown
# Which technique?

- For every element, the first larger one to its right >> monotonic stack
- Sorted array, find a pair with a given sum >> two pointers, one from each end
- Longest substring with at most k distinct characters >> sliding window
- Can you reach the end, jumping at most nums[i] from i >> greedy, tracking the furthest reach
```

**Keep these in one note that mixes techniques, under a heading that names none of them.** Two reasons:

- **The note's name and its headings are always shown above the question.** A signal card in `monotonic-stack.md` is shown under `monotonic-stack`, which answers it before you start. Parents that appear in the answer are hidden until you reveal it; the note's name and headings are not.
- **Mixing them is the practice.** When every card in a note has the same answer, you know it before you read the question. Mixed, you have to choose, and choosing is the skill.

### Cards for the method itself

How a technique works can live in a note named after it, because there the name is not the answer:

```markdown
# Monotonic stack

- What the stack holds >> indices still waiting for their answer, values decreasing from bottom to top
- When an index is popped >> when the current element is the first larger one to its right
- Why it is linear >> each index is pushed once and popped at most once
- Next smaller instead of next larger >> keep the values increasing rather than decreasing
```

Cards like these work for system design too: what a choice costs, and when you would make the other one.

**Keep each problem and your solution in your notes as ordinary text.** Code blocks are never read as cards, so a solution can sit under its own heading, beside the cards it taught you, without turning into cards.
