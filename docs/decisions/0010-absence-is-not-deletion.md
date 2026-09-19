# 0010 — Absence is not deletion: no tombstones

- **Status:** Accepted
- **Date:** 2026-09-19 (backfilled)
- **Source:** plan.md §5

## Context

Delete a note, restore it from a backup a year later, and its cards should come back on their original schedule. A branch switch should not destroy scheduling.

An earlier draft protected that property explicitly: a `created_at`, a `missing_since` written when a card was not found in a pass, a `deleted_at` tombstone written after seven days, and two sync steps maintaining them.

## Decision

Remove all of it. A card whose file is gone simply loses its `cards` row.

The property survives untouched, because **those columns were never what carried it**. It is carried by one rule instead:

> `reviews` is keyed on card ID alone and is never filtered by what `cards` holds, so a card's history outlives every row that refers to it.

Dropping a card row loses nothing. The next sync that finds the file re-inserts it — with `reviewed` set from the `card_state` that was still there — and the card returns to the queue on its original schedule, not as new.

## Rationale

What the tombstone machinery bought *on top of* that was one narrow thing: a card whose file was temporarily gone stayed in the queue for up to seven days. That behaviour is real, and it is now gone.

It is not worth three columns, two sync steps, a grace period, a rule about tombstones being reversible, and **a permanent asterisk on the claim that the database is derivable** ([0001](0001-plain-text-is-the-durable-store.md)).

## Consequences

- The rebuild test can assert full-table equality with no carve-outs. That total assertion is exactly what removing these columns bought, and it is the only version of the test that keeps proving the durability claim.
- Never hard-delete from `reviews` or `card_state`. That is where the line is, and `cards` is on the other side of it.
- New-card ordering loses `created_at` and loses nothing by it: ordering is `(file_path, line_no)`, which is what the old tiebreak was already doing all the work, since every never-reviewed card shared one `created_at` after any rebuild.
- `cards.reviewed` must be set on insert from `EXISTS(SELECT 1 FROM card_state WHERE card_id = ?)`, not defaulted — a restored card has state and must not re-enter the queue as new. The rebuild test is what catches this if it drifts.
