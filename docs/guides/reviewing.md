# Reviewing

A session is one question at a time. Recall the answer, reveal it, and say how it went — and how it went is the only thing you are ever asked, because the schedule is derived from it.

```sh
geode review          # 50 cards
geode review -n 200   # a bigger session
```

In the app it is the **Review** tab. **The keys are identical in both**, by construction rather than by convention: one table in the code says what each key means, and the terminal and the window both read it. Anything below that says "press `3`" is true of the button marked `3 good` as well.

## The four ratings

Any key flips the card over. Then:

| | | |
|---|---|---|
| `1` | **again** | I could not recall it |
| `2` | **hard** | I got there, but it was a struggle |
| `3` | **good** | I recalled it |
| `4` | **easy** | Instant, and the interval could have been longer |

That is the whole vocabulary. There is no "mark known", no bury, no suspend.

### When to press `hard` rather than `again`

This is the question every spaced-repetition user eventually asks, and it has a real answer: **did you produce the answer?**

- You produced it, slowly, with effort, maybe after a false start → `2 hard`.
- You did not produce it. You recognised it when you saw it, or nearly had it, or would have got it with one more second → `1 again`.

Recognising an answer is not recalling it, and the difference is the thing being measured. "I knew that really" after the answer appears is the most reliable feeling in all of studying and it is almost always wrong — this is *hindsight bias*, and it is exactly what a rating is supposed to see through. If you did not say it before you looked, it was `1`.

The two ratings do different things. `1` counts a **lapse** and sends the card back to the start; `2` keeps the card's history and shortens its next interval. Using `2` for cards you actually failed is the most common way to end up reviewing something for months without ever learning it: the schedule keeps stretching because you keep telling it you succeeded.

`4 easy` is worth being similarly careful with. It means *the interval was too short* — it pushes the next one out substantially. If the answer came instantly but the card felt about right, `3` is the honest key.

**Guessing correctly counts as `1`.** You want the schedule to describe your memory, not your luck.

## A card usually comes back in the same session

This surprises people, and it is the scheduler working rather than a bug.

A **new** card rated anything but `4 easy` is due again in **minutes**, not days: `1` in one minute, `2` in five, `3` in ten. A card you have been reviewing for months, rated `1`, comes back in five. So a session is not one pass through a list — a card returns when its time comes, and you answer it again, and only then does it move on to days.

Two things follow that you will see on screen:

- **The counter grows.** `3/23` becoming `3/24` is a second look being earned, not a miscount. The second number is *answers still owed*, and a card on a short step owes one.
- **"Finished" means nothing is owed**, not "you have seen every card once". A session of 23 cards is often 40-odd answers.

When the only cards left are due a few minutes out, they are shown **early** rather than making you wait — nothing ever counts down, and there is no timer. And a card you keep pressing `1` on keeps coming back, which is the point; `q` always works, and quitting is not a failure.

## `0 later` — the key for "not now"

Offered **only before you have seen the answer**, and it is the one action that records nothing at all: no rating, no history, no change to the card's schedule. The card moves to the back of the session and you will be asked again.

Use it when you have not attempted the card. Interrupted, distracted, someone spoke to you, or it is the kind of card that deserves attention you cannot give it right now. That is not a fact about your memory, so it is not recorded as one — and `1 again` would have been a lie the scheduler believes.

**It disappears once the answer is showing, on purpose.** Deferring a card whose answer you have just read would make the next sighting a sham: you would see it again with the answer fresh, rate it well, and the schedule would record a success you never earned. At that point the honest keys are the ratings — if you could not recall it, `1` already says so.

So `0` is not "show me this again for practice". It is "I have not answered this yet".

## `o` — open the note

Offered once the answer is showing. It opens the note the card lives in, at the card's line, so you can fix a typo, split a card that is doing two jobs, or read the paragraph around it.

**Set `editor` in your config if you want the line jump.** With no editor configured, GeodeMD hands the file to whatever your system opens `.md` with, and none of those can be told a line number — so you get the note, from the top. With a recognised editor it lands on the card: `vim +142`, `code --goto file:142`, `hx file:142`. See [`editor` in the configuration reference](../reference/configuration.md) for the list, and one trap worth knowing: `"editor": "vim"` is right in the terminal and wrong in the app, which has no terminal to type into.

The terminal and the app differ in one visible way here. The CLI **waits** for the editor to close, because a terminal editor has taken over the window; the app launches it and carries on. Both then tell you, at the end of the session, which notes changed while you were reviewing — because the cards on screen came from the last sync, so **an edited note needs a `geode sync`** before the change reaches your queue.

## Quitting, and what is saved

`q` quits, from the question or the answer. So does `Escape`, and so does Ctrl-C.

**Every rating you have already given is saved.** Each one is written to the review log and flushed to disk before anything else happens, so quitting, closing the window, a crash, or a dead battery costs you nothing but the cards you had not answered yet. There is no "end session" step and nothing to commit.

If a session says `database busy` and keeps going, that is the same mechanism showing through: your rating is in the log, and the database catches up by itself. Nothing is lost, though a card that would have come back in ten minutes will wait until next time.

## What a session shows you, and what it does not

**Which cards you get.** Cards that are due, most overdue first, then cards never reviewed, in the order they read in your notes. Nothing is randomised.

**A backlog fills the session.** Ask for 50 cards with 400 due and you get 50 due cards and no new ones. That is deliberate — recovering what you half-know beats piling on more — and `-n` is the way out if you disagree.

**No daily limit, and no "done for today".** A session is as long as you ask for. Nothing is being withheld, and nothing is being counted against you.

**A deleted card can still turn up.** `review` deliberately does not walk your notes — that is what keeps a session instant on a large collection — so a note you deleted since the last sync leaves its cards in the queue until you run `geode sync`.

The counter on each card (`3/24`) and the count of what the session was drawn from (`12 of 400 due`) are the whole of the progress reporting. At the end you get a tally of the ratings you gave, and the names of any notes you edited.
