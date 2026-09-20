# 0018 — User documentation lives in `guides/` and `reference/`, as plain Markdown

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

`docs/` was scaffolded with four directories — `decisions/`, `design/`, `guides/`, `reference/` — split by how stable each kind of writing is. That split is real and has held, but it says nothing about **who each directory is written for**, and the two questions are not the same.

The result is a line that has already blurred. `docs/reference/configuration.md` documents config keys and exit codes — a user looks those up. `docs/design/data-model.md` documents the same config's *schema* — a contributor reads that. `docs/guides/` has been empty since the day it was created, because nobody could say what belonged in it. And `README.md` carries install, quickstart and a command table alongside a Development section, which is contributor material sitting in the one document a user is guaranteed to read.

There is no home for the writing an end user actually needs, and no rule for where the next piece of it goes.

## Decision

**Audience is the organizing rule, on top of stability.**

| Directory | Audience | |
|---|---|---|
| `docs/guides/` | **users** | how to do a thing |
| `docs/reference/` | **users** | what to look up: config keys, commands, exit codes, card syntax |
| `docs/design/` | contributors | how the system works now |
| `docs/decisions/` | contributors | why it is that way |

`README.md` stays the **front door and nothing more**: what this is, install, quickstart, the command table, what it does to your notes, where data lives. It is what GitHub renders and what someone skims in ninety seconds. **It does not grow into a manual** — anything longer than a screen becomes a guide and gets linked.

**Plain Markdown in the repo, rendered by GitHub. No site generator, no theme, no deploy step.** This is a project with three runtime dependencies whose entire build is `tsc`, and whose brief says expandability comes from module boundaries rather than tooling. A docs site would be the largest piece of infrastructure in the repository, serving a user base that currently installs by cloning.

**Schemas stay in `design/`.** The original sketch put "config, API, schemas" in `reference/`, but a table definition is contributor material — `data-model.md` already holds it, correctly. `reference/` is what a *user* looks up.

## Consequences

- **`docs/guides/` gets an index that states the audience rule**, so the next person adding a file has somewhere to check rather than guessing. A directory that stayed empty for want of a definition now has one.
- **Guides are task-shaped**, named for what the reader is trying to do. The first ones this project needs are the situations the README can only warn about in a sentence: the first sync of an existing collection, recovering a database, and moving a collection between machines.
- **The README's Development section is contributor material in a user document.** Left alone for now — it is what a visitor looks for on GitHub, and moving it would trade one mismatch for another. Worth revisiting if the README grows.

## The gap this does not close

**A user who installs the Electron app has no reason to ever visit GitHub.** Markdown in a repository serves someone who cloned it; it does not serve someone who double-clicked an application and wants to know what `::` means.

That is the real limit of this decision, and it is named rather than papered over. When the app ships to anyone who did not build it, this gets revisited — most likely by rendering the same files in a Help window, so there is one source and two surfaces rather than a second copy that drifts. Nothing here forecloses that: the files stay plain Markdown precisely so a second consumer is cheap.

## Alternatives considered

**A static site.** Real navigation, search and versioning, and the honest choice if this had a large audience. Rejected for now: a generator, a theme, a deploy step and a domain, added to a repo whose build is one command, for a tool distributed by `git clone`.

**In-app help first.** Rejected as premature — the app has no shippable UI yet, and writing the content is the work either way. The files come first; the second surface follows when there is an app to put it in.
