# 0023 — Honour FSRS's short-term learning steps

- **Status:** Accepted
- **Date:** 2026-09-22

## Context

Our pinned FSRS parameters ([ADR 0007](0007-pin-fsrs-parameters-in-source.md)) have `enable_short_term` on. Measured against them — not quoted from the library's documentation, and reproduced by `host/queue.test.ts` so it stays true — a **new** card answered gives:

| key | due in | state |
|---|---|---|
| `1` again | 1 minute | Learning |
| `2` hard | 5 minutes | Learning |
| `3` good | **10 minutes** | Learning |
| `4` easy | 16 days | Review — graduated |

A second `good` ten minutes later graduates it to four days. A card already in Review rated `1` goes to Relearning, due in 5 minutes, `lapses` +1. A card answered `1` twice is not pinned at one minute — the second lands at five.

So **every new card answered anything but *easy* is already scheduled to come back before the sitting ends.** The due dates were correct in the database and correct in the log. The session simply never looked again: `getDueCards` took one snapshot and the queue was that snapshot until it ran out.

This was left open explicitly. [ADR 0022](0022-defer-a-card-without-rating-it.md) added `0 later` and said, in as many words, that it did not close this question and that the two are complementary.

## Options

**Leave it.** A session stays one pass through a snapshot, and a learning card comes back at the next `geode review`. Defensible on throughput and it needs no clock in the session model. But it means the tool computes the scheduler's instruction, writes it down, and ignores it — and the one thing a spaced-repetition tool must not do is quietly decide that its own schedule is optional. Relying on the user to notice they need another look is what the tool exists to replace.

**Honour them, capped at one re-show per card.** Cheaper on a backlog, and it bounds the worst case: a card rated `again` three times cannot dominate a sitting. Rejected because the cap is *ours*. FSRS asks for a specific second look at a specific time; a cap is a number with no argument behind it that would have to be defended forever, and it would make a session's behaviour depend on a rule the scheduler knows nothing about.

**Honour them.** A card the scheduler put on a short-term step comes back inside the same sitting, positioned by its real due time.

## Decision

**Honour them.** A rated card whose resulting state is `Learning` or `Relearning` is owed another answer in the same session, at the time the scheduler set.

Three rules decide what to show, and they live in `host/queue.ts` because both interfaces need identical answers:

1. **A card whose time has come goes first**, ahead of cards not yet seen. Re-testing it ten minutes later is the entire point of the step; holding it behind thirty unseen cards would defeat it.
2. **Otherwise the next unseen card**, in the snapshot's order — unchanged from before.
3. **Otherwise the earliest waiting card, served early.** Nothing else is left, so showing it now beats idling.

**The session never waits.** No timer, no countdown, no "come back in 4:12". Rule 3 is what makes that possible, and it is a deliberate choice over Anki's learn-ahead limit (default 20 minutes, after which it congratulates you and stops): a limit would need a number to defend, and a session that ends owing something has no good way to tell a GUI user when to return.

**The clock is read on a keypress, never while drawing.** The card on screen is chosen when a key is pressed and then kept. A renderer that asked "what is due now?" on every render would swap the card out from under someone mid-read the moment a learning card ripened — and they would then answer against a card they had not read.

**A card in short-term steps is identified by its state, not by how soon it is due.** `Learning` and `Relearning` are the scheduler's own instruction; "due within N minutes" would be our invention. The safety of that rests on the pinned parameters keeping those states minutes away, so `host/queue.test.ts` asserts both halves against the real scheduler rather than trusting them to stay in step.

## What it forced

**`core.reviewCard` returns the resulting `CardState`.** It computed one and discarded it. Recomputing it in an interface would mean a second copy of the FSRS fold, and the two would disagree the first time either changed.

**The IPC `Rated` grew a `next`** — `{ due, state }`, or null. Facts rather than a verdict: whether those facts mean "again today" is `host/queue.ts`'s single answer, so the renderer and the CLI cannot reach different conclusions from the same rating.

**The queue moved into `host`.** It had been a working array in the CLI's loop and a second one in the renderer's session model, which was survivable while the only rule was "`0` moves a card to the back". It is not survivable now: this ADR is a set of decisions about what a session *is*, and two interfaces answering them separately would each stay self-consistent while disagreeing — the same failure mode as two rating tables, and just as invisible ([ADR 0013](0013-cli-and-electron-are-peers.md), [ADR 0016](0016-config-lives-in-host.md)). `boundaries.test.ts` now greps for `inShortTermSteps` outside `host`.

**The session gained a third state for a rated card: in flight.** The renderer learns a card's new due time from an IPC round trip that resolves *after* the keypress that caused it. Without somewhere to put the card in between, a session whose last card was just rated would look finished, end, and then be handed a card to show. The CLI awaits `reviewCard` and passes through the same state in one step.

**The counter counts answers owed, not cards.** `3 / 24` following `3 / 23` is not a bug — it is a second look being earned. A fixed denominator would have to either lie or shrink.

## Consequences

**A session is roughly twice the answers.** The 23-card demo becomes ~46. On a large backlog throughput drops substantially. That is what learning steps *are*, and it is a real cost rather than a free improvement.

**"Finished" stops meaning "one pass through the queue."** It now means nothing is owed: every card has either graduated or been answered its way out of Learning.

**A card you keep failing keeps coming back.** Rated `1` in Relearning, it is due again in five minutes, and with rule 3 it will be served early if it is all that is left. Anki behaves the same way. `q` always works, and quitting with something owed says *stopped early*.

**A busy database costs the re-show, not the review.** If SQLite refuses the write, the rating is already `fsync`ed into the log and the next ingest reconciles it — but the new state was never learned on this side of the failure, so the card does not come back today. One lost second look, no lost review.

**`0 later` is unaffected and still not a substitute.** It records nothing and is voluntary; this is involuntary and is the scheduler's instruction. ADR 0022's reasoning stands unchanged.

## Source

Issue [#36](https://github.com/T1Fleming/GeodeMd/issues/36), and the end-of-queue policy decided in session. The intervals in the table above were measured against `FSRS_PARAMS`, not read from documentation.
