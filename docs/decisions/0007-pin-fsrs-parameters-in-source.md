# 0007 — FSRS parameters are pinned in source, not inherited

- **Status:** Accepted
- **Date:** 2026-09-19 (backfilled)
- **Source:** [phase-1 brief](../design/phase-1-brief.md) §2, §7

## Context

Scheduling is delegated to `ts-fsrs`. The natural way to use it is to call its generator with the library's defaults, which are maintained, sensible, and exactly what a new project wants.

But [0001](0001-plain-text-is-the-durable-store.md) claims the database is fully derivable, and the test that proves it replays a log and asserts the resulting `card_state` is identical. That holds only if the scheduler is a pure function of (history, parameters).

## Decision

Write the parameters out literally in source, and pin the dependency to an exact version rather than a `^` range:

```ts
export const FSRS_PARAMS = generatorParameters({
  w: [/* the full default weight vector, written out literally */],
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
});
```

Parameter *optimization* remains out of scope — the shipped defaults are fine until there are thousands of reviews. This is about where the values live, not what they are.

## Rationale

Two hazards, and only one is obvious.

**`enable_fuzz` randomizes each interval by a few percent.** With it on, a rebuild produces a different `due` than the run it rebuilt, and the rebuild test fails intermittently — the worst way for a test to fail, because the first few red runs read as flakiness rather than as a broken invariant.

**FSRS's default weights are a fitted model that the library revises.** A `ts-fsrs` minor bump can therefore change what a rebuild produces from an unchanged log: the notes stay durable while the schedule derived from them silently does not. Writing the vector out literally makes that a change someone makes on purpose.

## Consequences

- `boundaries.test.ts` asserts the parameters are present literally in `scheduler/`, so this cannot quietly regress to inheriting defaults.
- Upgrading `ts-fsrs` is a deliberate act with a diff to review, not a lockfile refresh.
- A failing rebuild test should be read as scheduler nondeterminism first — `enable_fuzz`, a shifted weight vector — before it is assumed to be an ingest bug.
- The parameters must not move to config. A user-tunable weight vector would make `card_state` a function of something outside the notes and the logs, which breaks [0001](0001-plain-text-is-the-durable-store.md).
