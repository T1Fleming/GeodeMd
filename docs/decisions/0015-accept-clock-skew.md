# 0015 — Accept clock skew; do not build vector clocks

- **Status:** Accepted
- **Date:** 2026-09-19

## Context

Replay is ordered by `rated_at`, a wall-clock timestamp taken from whichever device recorded the review. Every correctness claim that rests on ordering — that a rebuild reproduces `card_state` exactly, that reviews arriving late still land in the right sequence, that FSRS folds a history in the order it happened — assumes those timestamps are comparable.

A device with a badly wrong clock breaks that assumption, and it breaks it *permanently*: the log is append-only and never rewritten, so a review recorded under a wrong clock keeps its wrong timestamp forever. No rebuild repairs it, because a rebuild faithfully replays exactly what the log says.

## Decision

**Accept it.** `rated_at` is the sole ordering key. There are no vector clocks, no Lamport timestamps, no per-device causality metadata, and no server-assigned time.

## Rationale

The standard fix is a vector clock or equivalent, and the cost is not one field. Every log line would carry per-device causality metadata; ingest would maintain a clock per device; replay would become a merge rather than a range scan over a primary key. That is a permanent complexity tax on **the one file format in this design that can never be rewritten** — paid against a condition that is rare, self-inflicted, and usually noticed for reasons that have nothing to do with flashcards.

It also cuts against what the expandability here is supposed to come from: module boundaries and append-only logs, not richer formats and speculative interfaces.

## Consequences

- **A skewed device produces permanently mis-ordered history.** The log is not corrupt and nothing needs repairing — the derived schedule is simply wrong for the cards reviewed during the skew window.
- **The blast radius is bounded.** FSRS is a fold over one card's ordered ratings, so the damage is confined to cards actually reviewed on that device while its clock was wrong. Everything else replays identically.
- **Phase 1 is effectively unaffected.** One machine means one clock; it can be wrong, but it cannot disagree with another. This decision is a constraint on the multi-device future ([ADR 0014](0014-cross-device-sync-transport.md)), recorded now because the log format that makes it permanent is already shipped.
- **Millisecond precision stays load-bearing** for a different reason — it keeps `(card_id, rated_at)` from swallowing a genuine second review of the same card inside one clock tick. See [ADR 0005](0005-append-only-review-log.md).

## If this ever has to be revisited

**The fix is not a vector clock retrofitted into the log.** It is cheaper and less invasive to reject implausible timestamps at *write* time — a review dated before the card's previous review, or far in the future, refused or flagged as it is recorded — which keeps the format unchanged and stops bad data entering the one store that cannot be edited afterwards.

That is a smaller decision than the one being declined here, and it stays available.

## Alternatives considered

**Vector or Lamport clocks.** Rejected above: a permanent format change against a rare condition.

**Server-assigned timestamps.** Rejected on stronger grounds — it requires a server, which [ADR 0014](0014-cross-device-sync-transport.md) has not chosen and may never, and it would make the log no longer self-contained. A plain-text history that cannot be interpreted without a service is not the durable artifact [ADR 0001](0001-plain-text-is-the-durable-store.md) promises.
