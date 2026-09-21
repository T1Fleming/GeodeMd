# 0020 — Ship the user documentation inside the app

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

[ADR 0018](0018-user-docs-live-in-guides-and-reference.md) put the user documentation in `docs/guides/` and `docs/reference/` as plain Markdown, and named the gap it did not close:

> a user who installs a `.app` has no reason to ever visit GitHub, and no way to find out what `::` means.

That was acceptable while the only way to run GeodeMD was to clone the repository. Packaging ends it. Someone who installs a `.dmg` has the app and nothing else — no README, no `docs/`, and frequently no network at the moment they need to know why a sync reported `0 new`.

The syntax is the sharp edge. `question :: answer` with whitespace on both sides, skipped inside code blocks and tables, is not guessable and is not discoverable from the UI. Neither is the fact that the first sync edits every note containing a card.

## Options

**Write in-app help.** A screen authored for the app. Best-fitting text, and it drifts from `docs/` within two releases — which is the outcome ADR 0018 was written to prevent, arrived at from the other direction.

**Link out to GitHub.** One line of code. Requires a network at the moment of confusion, and sends the user to a page written for people reading a repository.

**Bundle the same Markdown and render it in the app.** One source, two surfaces.

## Decision

**Bundle it.** A Vite plugin copies `docs/guides/*.md` and `docs/reference/*.md` into the renderer bundle at build time, and a Help tab renders them with `marked`.

Four things follow from "one source":

**Only the user-facing sets ship.** `design/` and `decisions/` are contributor material. Shipping them would bury the four documents a user actually needs and turn Help into something nobody opens. This is ADR 0018's audience split, enforced by a build step rather than by convention.

**It is a copy of the file, not of the prose.** Nothing is rewritten for the app. If a guide is wrong in the Help window it is wrong in the repository, and one edit fixes both.

**Links out of the bundle go to a browser.** The docs were written for GitHub and link to ADRs and design docs that deliberately are not shipped. Those resolve against the repository's blob URL and open externally; links between bundled documents navigate inside the window. Left alone, a relative link would navigate the `app://` page away from the renderer and strand the user in a blank window.

**The release checklist moved out of `guides/`.** Issue #25 asked for it there. It cannot be: `guides/` is now shipped to every user, and a maintainer's checklist is not user documentation. It lives in [`docs/design/releasing.md`](../design/releasing.md). That this even needed deciding is the first consequence of the bundle being automatic — `guides/` stopped being a folder and became a surface.

## Consequences

The question ADR 0018 left open is answered, and answered in the direction it expected.

`docs/guides/` now has a second audience it cannot see. A guide that assumes the reader is at a terminal reads oddly in a window, which is why [`first-sync.md`](../guides/first-sync.md) now addresses both. New user documentation has to be written knowing it will be rendered in the app.

`marked` is a new dependency in `desktop/`. It is bundled into the renderer, not shipped to the CLI, and the repository's dependency-light posture is otherwise unchanged. Rendering our own Markdown with `dangerouslySetInnerHTML` is safe because the input is ours; **the moment a user's note text is rendered that way it stops being safe**, and would need sanitizing first. There is a comment at that line saying so.

## Source

Issue #25, and the gap ADR 0018 recorded in advance.
