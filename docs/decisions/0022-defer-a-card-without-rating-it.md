# 0022 — Defer a card without rating it

- **Status:** Accepted
- **Date:** 2026-09-22

## Context

Reviewing, you hit a card you are not ready to answer — interrupted, distracted, or it needs attention you cannot give right now. The four ratings are the only way forward, and all four record a measurement.

The obvious move is `1 again`, and it is the wrong one. `1` means *I could not recall this*, which FSRS folds into a lapse and uses to fit your weights. Pressing it because you were not paying attention teaches the model something untrue about your memory.

The request that started this was for next/previous buttons, which turned out to be three different features wearing one name.

## Options

**Previous, as undo.** Take back the rating you just gave. The rating is already appended to the log and `fsync`ed *before* SQLite is touched ([ADR 0005](0005-append-only-review-log.md)); that ordering is what makes a busy database a non-event. Undo means either a corrective entry — which FSRS folds as a *second* review, quietly wrong — or tombstones, which break append-only and with it the `(card_id, rated_at)` dedupe key and the cross-device convergence [ADR 0021](0021-no-built-in-sync-transport.md) rests on. Anki can do this because its revlog is a mutable table it owns. We cannot.

**Previous, as navigation.** Browse back through answered cards read-only. Cheap, and it solves a problem nobody reported.

**Honour FSRS's learning steps.** With `enable_short_term` on — which our pinned parameters have — a new card rated `1` is due in 1 minute, `2` in 5, `3` in **10**, and only `4` graduates. Every new card answered anything but *easy* is already scheduled to come back in the same sitting. We compute those due dates and then discard them, because the queue is a snapshot. Honouring them is Anki's behaviour and is a real option, but it is a large change to what a session *is*.

**Defer.** A key that means "not now", records nothing, and puts the card back in the queue.

## Decision

**`0` defers the card, and is offered only before the answer is showing.**

Nothing is recorded: no log line, no FSRS fold, no database write, no scheduling change. The card moves to the back of the queue and the session is not over until it has been answered or the user quits.

**Only at the question**, and this is the load-bearing half of the design rather than a limitation. Deferring a card whose answer you have already read would make the next sighting a sham: you would see it with the answer fresh, rate it well, and FSRS would record a clean success over an interval you never waited. A card you could not recall *is* a lapse, and `1` is the honest key for it. The narrow case a rating genuinely cannot express is the one where you never attempted it — which is only true while the answer is hidden.

So `0` is not "show me this again for practice". It is "I have not answered this yet".

## What it forced

`ACTION_KEYS` gained a **stage**. Until now every advertised key belonged to the answer, so both interfaces assumed the legend *was* the answer's legend — the app hard-wrote a `q quit` hint at the question, and the CLI printed no legend there at all. `host` now says which keys belong to which stage and both interfaces map it, which is the same anti-drift rule [ADR 0016](0016-config-lives-in-host.md) applies to everything else shared.

The CLI's review loop became index-driven rather than a `for…of`, because deferring reorders the queue.

## Consequences

Anki has no equivalent, and that is worth knowing rather than treating as an oversight — its position is that every step through the reviewer is a measured answer. This adds a step that is explicitly *not* a measurement, which is defensible only because it is unavailable once the answer is on screen.

**It does not close the learning-steps question.** `0` is voluntary, and relying on the user to notice they need another look is exactly what spaced repetition exists to replace. Honouring FSRS's short-term steps remains open, is complementary rather than an alternative, and would need its own ADR — it changes session length, throughput and what "finished" means.

Deferring the only card left returns it immediately. That is the truthful answer to "show me something else" when there is nothing else, and `q` always works.

## Source

Discussion in session, starting from a request for next/previous buttons.
