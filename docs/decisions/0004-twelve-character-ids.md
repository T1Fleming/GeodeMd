# 0004 — Card IDs are twelve characters, not eight

- **Status:** Accepted
- **Date:** 2026-09-19 (backfilled)
- **Source:** plan.md §4

## Context

Card IDs are stamped into the user's notes ([0003](0003-stamp-identity-into-the-note.md)), so every character is visible weight in a file someone reads and edits. The instinct is to make them short. Eight characters from `[A-Za-z0-9]` is 62⁸ ≈ 2.2 × 10¹⁴, which sounds like plenty.

It is not, at the scale this design targets — roughly a million cards.

## Decision

Mint `sr-` followed by **twelve** nanoid characters drawn from `[A-Za-z0-9]`.

## Rationale

The birthday bound, not the keyspace, is the number that matters. At a million cards:

| Length | Keyspace | Collision probability |
|---|---|---|
| 8 | 2.2 × 10¹⁴ | ≈ 2 × 10⁻³ — about one collection in 436 |
| 12 | 3.2 × 10²¹ | 1.6 × 10⁻¹⁰ |

One collection in 436 is not a rounding error, and it is not benign either, **because a collision does not fail loudly.** Two cards sharing an ID look exactly like the copy case in [0003](0003-stamp-identity-into-the-note.md): one of them is silently re-minted, and its history is left stranded against an ID nothing points to any more.

At 1.6 × 10⁻¹⁰, "do not build collision handling" becomes a defensible instruction rather than an optimistic one.

## Consequences

- No collision detection or recovery code exists anywhere, and that absence is justified by this number rather than by hope.
- Four extra characters per stamped line, in a stamp that is already invisible in every renderer. The cost is paid in bytes on disk, not in anything a reader sees.
- The `sr-` prefix plus twelve characters is the card's ID *everywhere*: `cards.id`, the `card` field in the log, the locator. There is no short form and no display variant.
