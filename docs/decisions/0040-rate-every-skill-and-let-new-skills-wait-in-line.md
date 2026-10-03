# 0040 — Rate every skill an exercise names, and let new skills wait in line

- **Status:** Accepted. Supersedes parts of [ADR 0038](0038-exercises.md), named below. How it works now is in [`design/exercises.md`](../design/exercises.md)
- **Date:** 2026-10-03

## Context

A time-shifted test run ([#81](https://github.com/T1Fleming/GeodeMd/issues/81)) used basic AWS system design exercises. It covered 16 days of app time, with 33 skill reviews. Two things in ADR 0038 didn't hold up.

**1. "Name any one tag and you're right" is too generous.** Most design problems need several patterns at once: a flash sale needs a load balancer, a cache and a queue. ADR 0038 counts naming any one of an exercise's skills as right, and rates only the skill that came due. Naming the queue and missing the cache is half an answer, and the cache, which was never asked, learns nothing either way.

**2. New skills waited behind due ones.** Practice offers the most overdue solve, with never-solved skills "after those, by name". A skill that keeps getting low ratings is always overdue, so it always wins. In testing, caching was solved four times in a week, while two skills tagged on day 0 waited seven and ten days for their first solve.

## Decision

### Every skill the exercise names is rated, one at a time

Supersedes ADR 0038's "Only the skill that came due is rated" and "In a spot review, naming any of the exercise's skills is right".

- **The reveal asks for a rating for each of the exercise's skills in turn**, the one that came due first and then the others in the order the note lists them. It's the same four keys and words for each skill, judged for that skill alone. For a spot review, `1 wrong skill` now means "I didn't name this one".
- **A one-skill exercise is unchanged:** one rating, as today.
- **The prompt becomes "Which skills does this call for?"**
- **Solves work the same way.** After `d`, each skill is rated for how well that part of the solution went.
- **One log line per skill**, all with the review's `at`, `exercise` and, for a solve, `took`. Uniqueness is `(skill, kind, at)`, so the lines are distinct, and a rebuild replays each one into its own skill's schedule. `repeat` is worked out per skill.
- **Skills that weren't due are reviewed early.** FSRS handles an early review, with less weight for the shorter gap. This is honest evidence about each skill, and it is what phase 3's "credit to prerequisite skills" would otherwise have had to infer, without the user maintaining a skill graph.
- **A skill rated in a sitting is not asked again in that sitting.** Its pending spot review is dropped, since its schedule has just moved.
- **All or nothing.** The ratings are sent together once the last is given. Leaving partway records nothing, like leaving any review unrated.

### A never-solved skill waits in line from its first spot review

Supersedes ADR 0038's "never-solved skills after those, by name", for solves.

- **For Practice's ordering, a skill with no solve counts as due for one since its first spot review.** That is the moment the user first met it, and it comes from the log, so a rebuild reproduces the order.
- **A skill never spotted either still comes after every other, by name.**
- **The rest is unchanged:** Practice offers the skill that has waited longest, one solve per visit.

Spot reviews keep their order: a never-reviewed skill is due at once, and [ADR 0039](0039-exercises-after-first-use.md) mixes them into the sitting.

## Alternatives

- **Rate only the due skill, with stricter words** ("named them all"). One number can't say which skill was missed, so the missed skill's schedule never learns.
- **Give partial credit to the other skills automatically.** That's a scheduling rule we'd have to invent, and FSRS has no notion of partial credit. Asking for each rating is simpler, and it's evidence rather than a guess.
- **Alternate between due and never-solved skills on Practice.** It works, but it's a rule about turns rather than about how long a skill has waited, and it needs its own state.
- **Put new skills first.** A lapsed skill would then wait behind every newly tagged one, which is the same starvation in the other direction.

## Consequences

- A multi-skill review takes a keypress per skill. Most notes have one skill, and the ones with three are the ones where the extra ratings matter.
- Skills shared across many notes are reviewed more often than their own schedule alone would ask for. That's the point, and it is accepted.
- The per-skill rating supersedes phase 3's "credit to prerequisite skills" for skills used together, which is deferred in #81.
