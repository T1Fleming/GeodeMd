# 0036 — Rating `1` is called *forgot*

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

The four ratings were labelled **again / hard / good / easy**. Those are Anki's button names: FSRS was built for Anki and fitted to its review logs, and `ts-fsrs` names its `Rating` enum after them.

The scale mixes two questions. *Again* answers "did you fail?". *Hard*, *good* and *easy* answer "how much effort did success take?". The word *again* sounds like "show me this once more", which is not what it does. It is the only failing rating. It counts a lapse, and on a card with eleven days of stability it leaves about one and a half. It also raises difficulty by about five points, and FSRS-6 pulls that back only very slowly (`w7 = 0.001`). Pressing it to mean "slow, but I got it" makes a card come back far more often than it needs to.

The reviewing guide already gave a whole section to telling `hard` from `again`. The buttons, which are where the choice is actually made, had nothing but the word.

## Decision

**Rating `1` is labelled *forgot*.** The other three keep their names. The label lives in `RATING_KEYS` in `host/present.ts`, so the review legend, the finished screen's tally and the guide's table all change together.

**Only the word changes.** The review log records the number, so nothing durable is renamed: no migration, no change to `SCHEDULER_VERSION`, and no re-derivation. Inside `scheduler/` the library's `Rating.Again` keeps its name, with a comment saying what the app calls it.

## Alternatives

- **Keep Anki's names and add a hint line under each button**, such as "couldn't recall" or "recalled, slowly". Rejected: the hint would explain a word that has to be explained. Changing the word is cheaper and is seen on every card.
- **Use outcome words for all four**, such as *forgot / struggled / recalled / too easy*. Rejected: *hard*, *good* and *easy* are not misleading, and they are what anyone arriving from Anki or the Obsidian plugin already knows. Only the word that pointed the wrong way changes.
- **Show each rating's next interval on its button**, as Anki does: `1m`, `10m`, `8d`. Deferred, not rejected. The preview would be exact, because `enable_fuzz` is off and `Scheduler.next` is pure, so four calls against the card's stored state give the due time each press would produce. It needs a new `Core` method and an IPC channel, though, and this change was kept to wording.

## Consequences

- GeodeMD's word for `1` differs from Anki's and from every other FSRS tool's. The reviewing guide says so in one sentence for people arriving from Anki.
- `boundaries.test.ts` now guards against a renderer defining `["1", "forgot"]` rather than `["1", "again"]`. Left on the old word, it would have passed forever while guarding nothing.
- Past ADRs that say *again* are left as written. They describe the rating, and the rating is unchanged.
