# 0039 — Exercises after first use: what testing changed

- **Status:** Accepted. Supersedes parts of [ADR 0038](0038-exercises.md), named below. Built in separate pull requests; how it works now is in [`design/exercises.md`](../design/exercises.md)
- **Date:** 2026-10-03

## Context

Phases 1 and 2 of [ADR 0038](0038-exercises.md) shipped, and [#81](https://github.com/T1Fleming/GeodeMd/issues/81) asked what real use says before phase 3. A test vault of 17 LeetCode exercises across 8 skills was reviewed in the app, with the clock moved forward to cover about ten weeks, and a 120-day simulation ran beside it. Five things went wrong that ADR 0038 didn't foresee.

1. **The order of spot reviews gave the answer away.** Skills never reviewed came in alphabetical order, and skills rated together stayed in that order. The last spot review of a sitting could be answered by elimination.
2. **A problem already solved came back as new.** "Repeat" was tracked per skill and kind. An exercise solved for `two-pointers` was offered a month later as a fresh solve for `monotonic-stack`, and about half of all spot reviews showed a problem whose solution had already been read on Practice. Each such review measured memory of that problem, and a `4` on it stretched the skill's interval on false evidence.
3. **Practice lost solves.** Each screen is mounted only while it shows, so visiting another tab mid-solve discarded the clock with no warning. Escape did the same.
4. **Notes gave their own answer away.** Anything between the title and `## Solution` was shown as the statement, including an `## Intuition` or `## Approach` section, which names the technique.
5. **Skills came due in lockstep.** With fuzz off ([ADR 0007](0007-pin-fsrs-parameters-in-source.md)), items rated alike on the same day come due on the same day, forever: all 8 skills fell due on the same two days, with three empty weeks between. Cards have the same problem: the cards written in one evening and reviewed in one sitting come back together, every time.

## Decision

### 1. Spot reviews are mixed in among the due cards, in an order that changes daily

Supersedes ADR 0038's "`getReviewItems` builds a sitting: due cards, then spot reviews, then new cards". Spot reviews go among the due cards rather than after them, in an order worked out from the skill and the day, so it is the same on every rebuild and machine, and different tomorrow. Mixing problem types is also what the research behind exercises recommends (Rohrer & Taylor 2007).

### 2. A solved exercise is used up, for every skill and both kinds

Supersedes ADR 0038's serving rule 2 ("not yet served for this skill and kind") and its definition of a repeat. Once you have seen an exercise's solution, by solving it for any skill, it is no longer new: it ranks after unseen exercises for every skill and both kinds, and serving it again is a repeat. A spot review shows no solution, so spotting still doesn't use an exercise up for a solve.

The cost is accepted: pools run dry sooner, and "add an exercise" appears more often. That message is now honest about when you are recalling an answer.

### 3. A solve under way outlives the Practice tab, and Escape doesn't leave it

The solve is held by the app, not the screen, and picked up again on return, with its clock still running from the offer. Escape does nothing on Practice; `q` leaves.

### 4. The statement ends at the first spoiler heading

Supersedes ADR 0038's "the statement runs from after the first `# ` heading to a `## Solution` heading". It ends at the first of `## Solution`, `## Intuition`, `## Approach`, `## Hint`, `## Hints` or `## Explanation`. The list is short on purpose: `## Examples` or `## Constraints` belong to the problem. A note still needs `## Solution` itself. `EXERCISE_VERSION` goes to `2`, so every vault re-reads every note once.

### 5. Fuzz on, for cards and skills, seeded in source

Revisits [ADR 0007](0007-pin-fsrs-parameters-in-source.md)'s `enable_fuzz: false`. That was chosen because fuzz made a rebuild disagree with the run it rebuilt. ts-fsrs 5 no longer draws fuzz from real randomness: it seeds it from the review. GeodeMD will supply its own seed, written in source like the weights. It will be built from the item's id, the review's time and the review count only, never from fractional state, because a difference in the fifteenth decimal place between two machines would otherwise become a difference of days.

This is built only if the rebuild test holds exactly, run many times. Fuzz touches only intervals of 3 days or more, so learning steps are unchanged. Every vault is rescheduled once, with the existing notice.

**The one-year cap stays.** For long-term retention, FSRS's long intervals are the point. Fixing decision 2 first removes the inflated ratings that stretched them.

## Alternatives

- **Shuffle with real randomness.** The order would differ between a run and its rebuild, and between two machines. Order is not stored, so that would be harmless today, but it would make the session untestable at a given `now`.
- **Track repeats per skill, as now, but warn.** The rating would still measure recall of a known answer.
- **Confirm before `q` leaves a long solve.** Not needed once Escape no longer leaves: `q` is deliberate.
- **End the statement at any `##` heading.** It would cut off a problem's own `## Examples`.
- **A shorter interval cap for skills, such as 60 days.** Right for someone with an interview in a few months, wrong for long-term retention, which is the goal.

## Consequences

- Rule 1, the "not served today" rule, and the repeat message are unchanged.
- The rebuild test is what decides decision 5. If it fails, fuzz stays off and this ADR gets a successor.
