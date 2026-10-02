# 0037 — Mark the line being asked, and reveal the answer in its place

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** [ADR 0032](0032-show-parents-as-remnote-does.md)'s layout: the question as the last bullet, with the answer drawn in a separate block below it

## Context

ADR 0032 draws a card where it sits: a path line, the parent bullets as an outline, and the question as the last bullet. A parent that is itself a card shows its answer, as `text → answer`.

So a nested card can show several lines that all look like cards, and only size and indentation say which one is being asked. In use that was not enough. A user looking at

```text
hi
• Lets do something → Here
   • Really similar
```

had to work out that the bigger line was the question. The parent, with its arrow and answer, looked like the more complete card of the two.

RemNote marks the line instead. The line being asked ends in `→` and a highlighted `?`, and the answer replaces the `?` when it is revealed.

## Decision

**The line being asked ends in `→` and a highlighted `?`, on every card, nested or not.** The reveal **puts the answer where the `?` was**, highlighted more lightly, and the separate answer block below the card goes away. A revealed card then reads exactly like a parent that is a card, `text → answer`, with the highlight saying which line was asked.

- The arrow and the blank are `host`'s (`ANSWER_ARROW`, `ANSWER_BLANK` in `host/present.ts`), like `CRUMB_SEPARATOR`. The parents' arrow uses the same constant, and the reviewing guide's journey draws its example with both, so the guide cannot drift from the screen.
- At the question stage, the arrow and the `?` form one unbreakable run, so a long question cannot leave the `?` alone on the next line.
- "press any key to reveal" stays under the question. The annotation stays under the card.

## Alternatives

- **A `?` marker, with the answer still in its own block below.** Rejected: the marker would point at an empty slot and the answer would then appear somewhere else. Revealing it in place is what makes the `?` read as "this is what you are being asked".
- **Show the marker only when there are parents.** Rejected: a card would look different depending on where it sits, for no gain. A lone question does no harm with a `?`.
- **Size and weight alone**, the ADR 0032 layout. Not enough once parents are cards too, as in the example above.

## Consequences

- A long answer now wraps under its question rather than starting its own block. The highlight is cloned on each wrapped line, so it still reads as one answer.
- The self-test checks that the `?` is on the line being asked and that the answer replaces it there. `.question` now holds only the question text, which is identical at both stages.
