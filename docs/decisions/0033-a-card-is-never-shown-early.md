# 0033 — A card is never shown before it is due

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** [ADR 0023](0023-honour-short-term-learning-steps.md)'s rule 3, "otherwise the earliest waiting card, served early"

## Context

ADR 0023 kept a card on a learning step inside its session, and added a third rule for the end of one: when only cards not yet due are left, show the earliest of them early. It was chosen over ending the session because "a session that ends owing something has no good way to tell a GUI user when to return".

In use, rule 3 shows a card again **seconds** after it was rated, whenever it is the only card left. FSRS records the real time of every review. A review seconds after the last one adds almost no stability, and `hard` there *lowers* it: a new card rated `hard` five times in a row ends up with less stability than it started with. One test vault had a card rated nine times in 95 seconds and scheduled a day out, the minimum, on stability of three hours. The early re-show was teaching the scheduler that the card was harder to hold than it was.

The reason given for rule 3 has since gone. Issue [#67](https://github.com/T1Fleming/GeodeMd/issues/67) gives a finished screen a way to tell the user when to come back: it can notice cards coming due and offer them.

## Decision

**A card is never shown before it is due.** The queue keeps ADR 0023's first two rules — a waiting card whose time has come, then the next unseen card — and drops the third. When neither finds a card, `serve` returns nothing and **the session ends for now**.

**The finished screen says what is still owed and when**: `1 card comes back at 12:06`, a clock time rather than a countdown, so nothing on it redraws every second.

**A screen with no card on it watches for cards coming due, and offers them** (#67). The finished screen and *Nothing due* both check, by asking for the due count. They check:

- when they appear;
- just after the due time they know of (the finished screen knows its owed cards');
- every `IDLE_RECHECK_MS` (60 seconds) otherwise;
- when the window comes back to the front;
- when **Check again** is pressed.

When something is due they show `N due now` and a **Review** button that starts a new sitting. **They never start one by themselves**: that would replace the finished screen's tally and its "notes changed, sync" warning before they were read.

### The timer, and why it is allowed here

ADR 0023 ruled out any timer in a session, and the reason was specific: a card must never change under someone reading it. These screens have **no card**, so a timer on them cannot do that. The rule stands everywhere a card is on screen. Nothing reads the clock while a card is drawn, and whether a card may be shown is still decided on a keypress.

**The session's end needs no clock.** It is over when nothing is on screen and nothing is waiting on the scheduler's answer. That can only mean the last keypress found no card it was allowed to show.

## Options rejected

| option | why not |
|---|---|
| Keep rule 3 | The reviews it produces are the ones FSRS credits least, and `hard` among them pushes a card's schedule the wrong way. |
| A learn-ahead window, as Anki has (show cards up to 20 minutes early) | Still shows cards early, just less often, and needs a number to defend. ADR 0023 rejected it for the same reason. |
| Keep the session open with a countdown to the next card | A timer on a screen that is about to show a card, which is exactly where the no-timer rule applies. It also holds the user in the session instead of letting them leave. |
| Start the next sitting automatically when a card comes due | Replaces the finished screen's tally and warnings before they are read, and moves a screen nobody touched. |

## Consequences

- **A short session ends sooner** and picks up again a few minutes later. A session of new cards rated `good` ends after one pass, and each card comes back about ten minutes later, offered by the finished screen.
- **A card that comes due mid-session is still shown on time.** Rule 1 is unchanged, so a waiting card that ripens while unseen cards remain goes ahead of them.
- **Each check is one capped count** (ADR 0024), so a check is cheap whatever the backlog. A failed check changes nothing on screen.
- **The self-test waits out a real one-minute learning step** to prove the timer, the count and the button are wired together. Its time limit went from one minute to three.
