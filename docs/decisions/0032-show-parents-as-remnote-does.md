# 0032 — Show a card's parents as RemNote does

- **Status:** Accepted
- **Date:** 2026-10-01
- **Amends:** [ADR 0031](0031-forward-cards-and-context.md)'s one-line breadcrumb above the question

## Context

ADR 0031 drew a card's context as one grey line, `cells › Biology › Cell › Nucleus → holds DNA`, with each segment cut at 40 characters. Real outlines make that line long and hard to read, and the cut lands on exactly the text that gives a short question its meaning.

RemNote draws it differently ([Hiding Ancestors on Flashcards](https://help.remnote.com/en/articles/9631727-hiding-ancestors-on-flashcards)). The document's path is a small breadcrumb at the top. The parent bullets inside the document are shown in full as an indented outline, so the card reads as the last bullet of its own outline. A parent whose entire text is in the card's answer is hidden automatically.

## Decision

**The note's name and its headings go on a small path line. The parent bullets go in an outline beneath it, and the question is the last bullet.** Headings are a Markdown note's nearest thing to RemNote's document path; bullets are its rems. `ContextEntry` therefore records `kind: "heading" | "item"`.

**The nearest three parents are shown in full, and older ones fold** behind a `… N more` button. A parent longer than two lines is cut, and a click shows the rest. A deep outline would otherwise push the question down the screen, and the nearest parent is the one a short question leans on. RemNote shows every parent, which is the one place this departs from it. Both numbers are `host` constants (`ANCESTORS_SHOWN`, `ANCESTOR_LINES`), and no key is added for either: they are a click, not part of reviewing.

**A parent whose text appears in the card's answer is left out until the answer is revealed**, as RemNote does. The match ignores case and runs of whitespace. Spoilers are removed before folding, so the parents shown are the nearest ones that can be shown. Headings are never treated as spoilers: they are where the card is, not part of it.

**Which parents are shown, how many, and which are spoilers is decided in `host`** by `cardContext(card, { revealed, expanded })`. The renderer draws its result and holds the two things a click can change.

### A context version, separate from the syntax version

Rows written under ADR 0031 have no `kind`, so every vault has to re-read every note once. ADR 0031's `SYNTAX_VERSION` would do that, but it also tells the user that the card syntax changed and to preview before syncing, because that kind of re-read can stamp lines. This one cannot: it changes context, never which lines are cards.

So the parser has a second version, `CONTEXT_VERSION`, recorded in `meta` under `context`. A sync re-reads everything when either version is stale and records each one under ADR 0031's rule. `syntaxChanged()`, and the notice that depends on it, still look only at the syntax version. Until the re-read, a stored parent without a `kind` is drawn as a bullet.

## Options rejected

| option | why not |
|---|---|
| Keep one line, shorten better | Still one line holding a whole outline, and still cuts the nearest parent short. |
| Everything as one outline, headings included | Headings would take a bullet's place and push the parent bullets further right. RemNote keeps the document path apart from the rems. |
| Every parent in full, as RemNote does | A deep or wordy outline buries the question. Folding keeps the nearest parents, which are the ones a short question needs. |
| Bump `SYNTAX_VERSION` for the new field | Would warn every user about a change of card syntax that did not happen. |

## Consequences

- Every vault's next sync reads every note once, silently, to fill in `kind`.
- The demo nests two cards in `aws/lambda.md` under a parent bullet, so the self-test has a nested card to check.
- Out of scope: RemNote's per-card controls (`/no hierarchy`, `/hide in queue`, `/remove from queue`), and hiding the path line.
