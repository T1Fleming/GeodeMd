# 0028 — Move to FSRS-6, and re-derive schedules when the scheduler changes

- **Status:** Accepted
- **Date:** 2026-09-24
- **Supersedes:** the version part of [0007](0007-pin-fsrs-parameters-in-source.md): `ts-fsrs` 4.6.1 and its 19-weight FSRS-5 vector. The rule in 0007 stands: every parameter is written out literally, and the dependency is pinned to an exact version.

## Context

`ts-fsrs` was pinned to 4.6.1, which implements FSRS-5 with 19 weights. 5.0.0 moved to FSRS-6 with 21 weights, 5.4.2 is the current release, and 4.x gets no fixes. FSRS-6 is the model the Open Spaced Repetition project now maintains.

[0007](0007-pin-fsrs-parameters-in-source.md) made the pin deliberate so that a version bump could not quietly change what a rebuild produces from an unchanged log. This one does change due dates, on purpose, and that needs a record.

These facts were checked against the installed 5.4.2 package, not taken from the changelog:

- **Given 19 weights, `generatorParameters` does not fail.** `migrateParameters` pads the vector to 21 with `[0, 0.5]` and logs `[FSRS-6]auto fill w from 19 to 21 length` on `console.debug`. That is FSRS-5's fitted weights on FSRS-6's engine, with a fixed decay of 0.5.
- **FSRS-6's defaults are a different vector.** `default_w` is `0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542`.
- **The short-term steps are now parameters.** `learning_steps` defaults to `["1m", "10m"]` and `relearning_steps` to `["10m"]`. `enable_short_term` still defaults to `true`, and it decides whether the steps apply at all.
- **`Card` gains `learning_steps: number`**, the index of the step the card is on. The next interval depends on it: `3` on the first step moves to the second, and `3` on the second graduates.
- **`elapsed_days` on `Card` and `ReviewLog` is deprecated**, marked for removal in 6.0.0. The engine does not read it on `next`, because it computes the interval from `last_review` itself.
- **Node `>=20`.** `.nvmrc` is 24, so nothing changes there.

## Decisions

### The version: `ts-fsrs` 5.4.2, exactly

This is the latest 5.x. 6.0.0 exists only as betas. The pin stays exact (`"ts-fsrs": "5.4.2"`), and `TS_FSRS_VERSION` in `src/scheduler/` repeats it. `scheduler.test.ts` checks that it matches both `package.json` and the installed package, so a bump cannot land without someone changing the source.

### The weights: FSRS-6's defaults, all 21, written out

The alternative was to keep FSRS-5's behaviour by writing out the padded vector: the old 19 weights plus `0, 0.5`. It was rejected because it would move to the maintained engine while keeping the unmaintained model. Moving to that model is the reason for the upgrade. Keeping FSRS-5's weights would also have left the result unlike anything else: with `w[19] = 0` and a fixed decay of 0.5, FSRS-6's engine never runs the model it was built for, and nobody else would be testing that combination.

All 21 weights are written out literally, so the fill never runs and nothing is logged. `boundaries.test.ts` counts them in the source. `scheduler.test.ts` checks that what `generatorParameters` hands back equals what was written, so nothing was padded or clipped (`clipParameters` still runs on a 21-vector), and that they equal 5.4.2's `default_w`. That last check is not a way of inheriting the defaults. It makes a later bump that moves them fail, which is the moment to decide again.

`learning_steps: ["1m", "10m"]`, `relearning_steps: ["10m"]` and `enable_short_term: true` are pinned literally too. The boundaries test checks that the source names all three. They are the library's defaults, and they are what [ADR 0023](0023-honour-short-term-learning-steps.md)'s same-sitting re-show depends on.

### What that changes for someone reviewing

Measured against `FSRS_PARAMS`, and held there by `host/queue.test.ts` and the reviewing journey:

| | FSRS-5 (4.6.1) | FSRS-6 (5.4.2) |
|---|---|---|
| new card, `1` again | 1 minute | 1 minute |
| new card, `2` hard | 5 minutes | **6 minutes** |
| new card, `3` good | 10 minutes | 10 minutes |
| new card, `4` easy | 16 days | **8 days** |
| `3` then `3` ten minutes later | 4 days | **2 days** |
| a Review card rated `1` | Relearning, 5 minutes | Relearning, **10 minutes** |
| `1` twice on a new card | the second lands at 5 minutes | the second stays at 1 minute |

ADR 0023 still holds. Every `Learning` and `Relearning` state is minutes away, and every graduation is days away, so `inShortTermSteps` stays a state test and the re-show is unchanged. `queue.test.ts` asserts both of those against the real scheduler, and the app's self-test still sees a card rated `good` owed a second answer in the same sitting. ADR 0023's table records FSRS-5's numbers. It is left as written, and `docs/guides/reviewing.md` and `docs/design/review-flow.md` now give these.

### The card: a `learning_steps` column, and no blanket cast

`card_state.learning_steps` stores the step, and `CardState` carries it. It is replayed from the log like every other column, so a rebuild still reproduces the database exactly. The rebuild test now leaves a card on its second step, so the comparison covers a value the default cannot produce by accident. Without the column, a card rated `3` would forget its step on the way through the database. Its next `3` would then keep it ten more minutes in Learning where it should have graduated, and `review.test.ts` checks that it graduates.

`fromCardState` used to build its card with `as FsrsCard`, which would have let the new field go missing without a word from `tsc`. It now returns `Omit<Card, "elapsed_days">`, so every other field is checked, and it no longer sets `elapsed_days`. One narrow cast is left, at the call to `engine.next`. It covers only the deprecated field: 5.x still lists it on `Card`, and no object without it satisfies the type. It can go when 6.0 removes the field.

### Existing databases: record the scheduler, and re-derive the schedule when it differs

The store recorded nothing about which scheduler derived `card_state`, so a database written under 4.6.1 could not tell that anything had changed. After an upgrade, incremental reviews would fold FSRS-6 onto FSRS-5 states. Every card would be a mix of the two until the next rebuild, and nothing would say so.

A new `meta` table records `SCHEDULER_VERSION`, which is the `ts-fsrs` version plus every parameter as JSON. It is built from the parameters rather than bumped by hand, so any future parameter change triggers the same path without anyone having to remember to. On opening a vault, `Core.adoptScheduler(now)` compares the recorded version with the running one. When they differ, it re-derives every `card_state` row from that card's full history and then records the new version.

**This is a re-derivation of `card_state`, not an automatic `rebuild`.** The brief for this change said to rebuild. There are four strong reasons not to do that from a launch:

1. **A rebuild writes into the user's notes.** It is a full sync, so it stamps every card written since the last sync. The app never does that without the user asking, and the first sync of a vault goes through a preview for exactly this reason. A launch that edits notes because the app was updated breaks that rule.
2. **A rebuild needs the notes folder, and drops tables before it finds out whether the folder is there.** With the folder on an unplugged drive, `dropAll` succeeds and `sync` then throws. That leaves an empty database behind the repair screen.
3. **It is the wrong size of job.** Only `card_state` depends on the scheduler. `cards`, `files`, `reviews` and `log_files` would be rebuilt from scratch to arrive where they already are: a full walk, a re-read of every log shard, and minutes at the top of the scale range.
4. **It gives the same answer for what changed.** `card_state` is a fold of `reviews`, and a rebuild's replay is that same fold. The test "re-derives every schedule to exactly what a rebuild produces" compares the whole database after each.

The rows for cards whose line has gone are re-derived too. `card_state` outlives its card on purpose, and a restored card has to come back with the new scheduler's schedule. A row with no history left is deleted, since a rebuild would not recreate it.

Measured on an in-memory database of 100,000 cards and 400,000 reviews, the re-derivation took 1.4 s. It runs in batches of 2,000 with the event loop let back in between, so the longest stall was about 60 ms, which is the pattern [ADR 0017](0017-core-runs-in-the-main-process.md) relies on. The new version is written in the same transaction as the last batch. A run cut short therefore leaves the old version recorded, and the next launch starts again, which is safe because every row is derived from zero.

A database from before this change has neither the column nor `meta`. `Store` adds the column on open (`ALTER TABLE … ADD COLUMN`, default 0) so that no query fails before re-derivation can run. The version is absent, so every row is then re-derived. A database with no version and no schedules is new, and it only gets the version recorded. `rebuild` records the version itself, because everything it derives is derived by the running scheduler.

### Where it lives, and how the user finds out

- **`core`** owns the policy. `adoptScheduler(now)` takes the time as an argument and reads the scheduler's `version` from the `Scheduler` it was given. It reads no config and no environment.
- **`store`** owns the SQL: the `meta` table, `getMeta`/`setMeta`, `scheduledIds`, `deleteState`, and the column migration.
- **`scheduler`** owns `SCHEDULER_VERSION`.
- **`electron/main/active.ts`** runs the check when it opens a vault, before any read can see a due date. Opening therefore awaits, so `ensure` is now single-flight. The review screen asks for the queue and the counts at once, and two opens would mean two Stores on one file.
- **The user is told once, on arriving at the vault.** `App.tsx` calls the new `vaults/open` channel before any screen reads. It shows `host`'s `rescheduledText` as a note: how many cards, that due dates may have moved, and that the notes and the review log are unchanged. That last part matters because due dates that move without a word read as lost reviews. The main process hands the answer over once, so arriving at the vault again does not repeat it. `boundaries.test.ts` keeps the wording in `host`.

## Consequences

- **Due dates move once, on the first launch after the upgrade.** New cards graduate sooner on `easy` and later on a second `good`, and a lapse waits ten minutes rather than five. A user sees one note saying why.
- **A future parameter change is handled the same way.** Changing a weight, `request_retention` or a step changes `SCHEDULER_VERSION`, and every vault re-derives its schedule the next time it is opened. It is no longer the case that a changed parameter reaches old rows only when someone presses Rebuild.
- **`meta` is derived from the code**, the way the schema is, rather than from the notes or the log. The rebuild test's comparison does not include it, and a separate test checks that a rebuild records the running version.
- **Fitting weights to the user's own history is still out of scope.** The optimizer is published separately as `@open-spaced-repetition/binding`, and using it raises the question of where fitted weights live so that a rebuild can still reproduce the database. `SCHEDULER_VERSION` would make a change of weights re-derive the schedule. That is part of the answer, not all of it.

## Source

Issue [#50](https://github.com/T1Fleming/GeodeMd/issues/50). The package facts were checked against the installed `ts-fsrs` 5.4.2, and the intervals were measured against `FSRS_PARAMS`.
