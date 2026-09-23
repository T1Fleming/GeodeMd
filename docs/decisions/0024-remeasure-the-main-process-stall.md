# 0024 — The main-process stall at fifty times the measurement

- **Status:** Accepted
- **Date:** 2026-09-22

## Context

[ADR 0017](0017-core-runs-in-the-main-process.md) put `core` in the Electron main process on a measurement, and said three things about it that this ADR is the discharge of:

> **This is not extrapolated to the million-card design target.** Fifty times the data is not fifty times the stall in any way that has been measured.

> **Re-measure before the vault grows an order of magnitude**, and before shipping to anyone whose collection is much larger than the one measured.

> If the number ever stops being acceptable, the move is already specified: implement `protocol.ts` over a `MessagePort` into a `utilityProcess`.

Now that the app can be packaged and handed to someone, this stopped being hypothetical. So: measured again, at ten times and at fifty times.

## The measurement

`src/measure/bench.ts` samples the **main** process's event loop on a 20 ms interval while each operation runs. A gap larger than the interval is time the loop could not have answered a click, a menu, or an IPC message. Electron 33.4.11, Node 20.18.3, Apple Silicon.

Two collections, both built by `src/measure/vault.ts` — 50 cards per note, 100 notes per directory, reviews spread over the preceding six months at ADR 0017's ratio of 0.4 per card:

| | cards | files | reviews in the log | due |
|---|---|---|---|---|
| ADR 0017 | 20,000 | 1,000 | 8,000 | — |
| **ten times** | 200,000 | 4,000 | 80,000 | 78,000 |
| **fifty times** | 1,000,000 | 20,000 | 400,000 | 389,000 |

Worst main-process stall, `core` in main, on freshly built collections, with the two mitigations below in place — dropped frames in brackets, elapsed after:

| operation | 20,000 (ADR 0017) | 200,000 | 1,000,000 |
|---|---|---|---|
| `sync --full` | 1.0 ms | **4.5 ms** [0] · 3.4 s | **3.1 ms** [0] · 19.4 s |
| 4,000 ratings | 6.1 ms | **7.9 ms** [0] · 20.1 s | **121.0 ms** [2] · 20.8 s |
| `rebuild` | 1.3 ms | **14.3 ms** [0] · 6.6 s | **160.1 ms** [10] · 43.1 s |

**At ten times the original collection, nothing drops a frame.** At fifty times — the design target — ratings and `rebuild` both stall past a tenth of a second.

The same operations in a `utilityProcess` never exceeded **13.5 ms** and never dropped a frame, at either size, in any run. That figure is the harness's floor: it forks a worker per operation and about 10 ms of it is the spawn.

### The operation the bench never measured

`stats` is not in the table above, and it turned out to be the interesting one. It is four counts, and it runs when the user opens the **Collection** tab — a screen nobody thinks of as expensive. At a million cards with 389,000 due, before anything was done about it:

| count | measured |
|---|---|
| `countDue` | 205 ms warm, 315 ms cold |
| `countDueBefore` | 198 ms warm |
| `countNew` | 476 ms cold, 526 ms on a fresh connection |
| `countCards` | 416 ms cold, 4 ms warm |
| **`stats`, all four** | **632 ms warm, ~1.3 s cold** |

**The cost is proportional to the size of the set being counted, not to the collection.** `countDue` probes `cards` once per due row — the join is there because `card_state` deliberately outlives its card ([ADR 0010](0010-absence-is-not-deletion.md)), so counting state alone over-reports — and the due set is a number the user's own habits set. A backlog is exactly what a spaced-repetition user accumulates. `countNew` has the same shape: 600,000 new cards is one sync away.

### What a rating burst actually hits

Timing 1,500 individual ratings at a million cards found a stall every **~208** of them, 22–33 ms each. `wal_autocheckpoint` is 1,000 pages and a rating writes about five: this is SQLite folding the write-ahead log back into the database, and it is inherent to writing.

The large ones — 100–300 ms — are the same mechanism against a WAL that some earlier **bulk** write left big. In a session, the bulk write before the first rating is a `sync`, and the user's first keypress paid for it.

## What the first run of this got wrong

Three flaws, each of which made a number mean something other than it appeared to, and all three fixed in the harness rather than worked around:

**A 161-second "stall."** Recorded for every run where main merely waited on the worker. macOS naps a process that has no window and is doing nothing, and a napped process's timers stop firing — the instrument was asleep, not the loop. `powerSaveBlocker.start("prevent-app-suspension")` for the duration of the run fixed it, and without that fix the whole `utilityProcess` column was unreadable.

**No elapsed time.** "Worst 160 ms" means one thing inside a 6-second rebuild and another inside a 43-second one, and the first report did not say which. Every row now carries both.

**Each operation was charged for its predecessor.** The worker runs an operation and is then killed without closing its database, so main's run began by folding in a WAL left by 4,000 ratings that were not being measured. The pre-mitigation rating figures — 114/154 ms at 200,000 and 198/299 ms at a million — are that artifact stacked on the real mechanism, and the same effect inflated `rebuild` at a million to 233–415 ms where a clean start measures 160 ms. Each measured operation now checkpoints first, so it measures itself.

None of that changes the shape of the answer — `rebuild` and a rating burst both stall at the design target, `sync` never does — but three of the six numbers in the first table were partly measuring the harness.

## Decision

**`core` stays in the main process. The seam stays. Two stalls are removed where they are, and `rebuild` is accepted as it is.**

**1. Every count that can grow without bound stops at a limit (10,000) and reports a floor.** The limit is `host`'s `COUNT_CAP`, passed into `stats(now, limit)` — policy in `host`, `core` taking it as an argument like it takes `now`. That is not only tidiness: the renderer imports `host/present.ts`, so a *value* import from `core` in that file pulls `better-sqlite3` into a browser bundle. It did, once, and presented as `c(...).join is not a function` from minified code. `stats` at a million cards goes from 632 ms to **9.4 ms** warm; at 200,000 it is 6.4 ms. The exact size of a backlog stops being actionable long before ten thousand — "10000+ due" and "38661 due" ask the reader for the same thing. `host`'s `countText` owns the wording, so `geode stats` and the Collection tab cannot say it differently.

**`countCards` is the one count left uncapped.** The total is a fact about the collection rather than about a backlog, and "10000+ cards in total" is a worse answer than the 4 ms it costs warm. It is most of what remains of the first `stats` call: **598 ms at a million cards, 166 ms at 200,000, then 9 ms and 6 ms for every call after.** That is the largest stall knowingly left in the app.

**2. `sync` folds the write-ahead log back in before it returns.** The cost lands inside an operation that already has a progress bar, rather than on the first rating of the session after it. With a bulk write immediately before the burst — which is what a session does when a sync precedes it — the worst rating stall at a million cards was 198–299 ms before this change and 15.7–42.7 ms after. From a clean start it is 121 ms at a million and **7.9 ms at 200,000**, which is the periodic auto-checkpoint and nothing else. `PASSIVE`, so a checkpoint can never wait on a reader: trading a stall for a hang would be a worse deal.

**3. `rebuild` keeps its stalls, and that is a decision rather than an omission.** At a million cards, ten hitches with a worst of 160 ms across 43 seconds, which make a progress bar stutter. (At 200,000 it drops no frames at all.) What they do not do is cost the user an action, because [there is no cancel button](../design/app.md) and nothing else in the window does anything during a rebuild — it is modal by design, entered deliberately, and rare. Fixing this specifically is the one thing a second process would buy, and paying a process lifecycle, crash-and-respawn handling, a second IPC hop and progress relayed twice for a stuttering bar is the trade [ADR 0017](0017-core-runs-in-the-main-process.md) and [ADR 0011](0011-enumeration-is-a-seam.md) both refuse.

**The escape route is unchanged and still specified**: `protocol.ts` over a `MessagePort` into a `utilityProcess`, with `src/electron/worker/` retained as the working proof that it runs. The measurement above is also the strongest evidence yet that it would work — the worker column never dropped a frame at any size.

## Consequences

- **A collection of a couple of hundred thousand cards is fine as it stands.** Ten times ADR 0017's measurement drops no frames in any operation, which is the question [#39](https://github.com/T1Fleming/GeodeMd/issues/39) was actually asking before a build goes to someone.
- **A million-card collection stutters in two places, both bounded**: a rating burst (~120 ms, a couple of times in 4,000 ratings, so roughly once per several minutes of human-paced review) and `rebuild`. Neither loses data or an action.
- **A count may now be a floor.** `Counts.capped` says so for the sums both interfaces show; a single figure needs no flag, because a capped count is exactly equal to the cap. `10000+` is the only wording, and it lives in `host`.
- **The stall that remains is on the Collection tab, not in the review loop.** First open at a million cards, ~0.6 s; every open after, ~9 ms. Worth knowing before handing a build to someone with a collection that size, and cheap to fix if it ever bites: cap the total too, or accept an approximate one.
- **`rebuild` on a million cards takes 40 seconds and stutters.** The progress bar is what makes that tolerable, so it must not be removed, and it must keep reporting the ingest phase separately — most of the time is the replay.
- **The renderer self-test earned its keep again.** The bundle breakage above type-checked, built, and passed every unit test; what caught it was a harness that clicks real buttons in a real window.
- **The harness is reproducible now, which it was not.** `src/measure/vault.ts` builds the collection; neither half lives under `src/electron/` any more, because an interface may not import `files/` and a fixture generator needs the log's layout. The next re-measurement is `node dist/measure/vault.js <dir> <cards> <reviews>` and one command.
- **Re-measure again before assuming anything about a collection larger than a million cards**, and treat any new unbroken synchronous span in `core` as invalidating all of this — which is what ADR 0017 said, and remains the standing rule.
- **`sync` needs no further defence.** Three measurements, across a 50× range, all under 9 ms.

## Source

Issue [#39](https://github.com/T1Fleming/GeodeMd/issues/39). Every number here was measured on the collections described; none is extrapolated, and the two that were wrong in the first run — the 161-second worker "stall" and the missing elapsed times — are recorded above rather than quietly dropped.
