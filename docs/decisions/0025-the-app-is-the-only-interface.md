# 0025 — The app is the only interface; the CLI is removed

- **Status:** Accepted
- **Date:** 2026-09-23
- **Supersedes:** [0013](0013-cli-and-electron-are-peers.md)

## Context

[ADR 0013](0013-cli-and-electron-are-peers.md) said the CLI and the Electron app were peers over one `core`, **permanently**, on two arguments: the CLI composes with scripts, and a terminal review loop is the fast path when you are already in a terminal.

The second argument is the one that failed. **Nobody reviews flashcards in a terminal** — it is a niche inside a niche even among people who keep their notes as Markdown in a folder, and the reviewing experience is the part of this tool that most wants a GUI. The 205-line interactive loop had no automated coverage at all, because it requires a TTY; covering it meant a pseudo-terminal harness and a native dependency, and that bill is what prompted the question.

The app now does everything a person at a desktop needs: first-run setup writes the config, the Sync screen offers preview, real sync and `--full`, rebuild is confirmed and run, the Collection screen reports the counts, review works, and the documentation ships inside it ([ADR 0020](0020-ship-the-docs-inside-the-app.md)).

## Options

**Keep both, invest in neither.** Deprecate the loop, mark it best-effort, keep the non-interactive commands. Cheapest, and it keeps a second consumer for `host` — but it leaves a surface nobody uses and a README that leads with the wrong thing.

**Remove the review loop, keep `sync` / `rebuild` / `stats` / `init`.** Removes exactly the part that fails the argument above, and keeps a scripting surface: a git hook, a cron job, an ssh session. Rejected here, but it is the option to revisit first if any consequence below starts to bite.

**Remove all of it.** The app is the product; one interface, one story.

## Decision

**`src/cli/` is deleted. The Electron app is the only interface.**

The `geode` binary is gone, and with it `bin` in `package.json`. `core`, `host`, `store`, `files`, `parser` and `scheduler` are unchanged.

## What this costs, stated rather than implied

**Automation is gone.** No git hook, no cron job, no `geode sync` from a shell script or from Obsidian's shell-command plugin. An Electron app cannot be invoked by a git hook. This is the real loss, and it is a loss of *kind* rather than of convenience — there is no GUI equivalent to add later.

**Headless and remote use are gone.** No reviewing or syncing over ssh, and nothing usable on a machine with no display.

**A rhetorical loss.** "Your cards are lines in your own files, and this tool is not a lock-in" was easier to *believe* with a command-line tool that operated on those files. The claim is still true and still tested; it is now harder to demonstrate in one command.

**`host`'s boundaries become discipline rather than arithmetic.** The shared queue, key table, summary vocabulary and editor table were all extracted because two interfaces disagreed, and `boundaries.test.ts` could compare them. With one consumer those rules still keep decisions out of the renderer — which is worth something, because a decision that arrives in a component arrives with a layout attached and stops looking like a decision — but nothing is being *compared* any more. They are kept deliberately, in that weaker form, and `host` is where a second interface would reconnect.

**There is no installable interface until the app is signed.** The `.dmg` is unsigned ([#38](https://github.com/T1Fleming/GeodeMd/issues/38), blocked on an Apple Developer account), so today GeodeMD is built from source and run from `desktop/`. Removing the CLI before signing was a sequencing risk taken knowingly rather than overlooked.

## Consequences

- **Exit codes stop being a contract.** `host/errors.ts` keeps `ErrorKind`, because the app tags IPC failures with it, but `0` / `1` / `2` no longer mean anything to anyone.
- **The pseudo-terminal harness will not be built.** That question is closed by this decision rather than by its cost.
- **A CLI could come back cheaply.** `core` takes every ambient thing as an argument and `host` holds the vocabulary, so a second interface remains a renderer-sized job rather than a rewrite. That was ADR 0013's real payoff and it survives the interface it was written about.
- **The documentation leads with the app.** The README, the guides and `reference/configuration.md` described a command line; they now describe a window. The [journeys](../design/testing.md#the-journeys) hold them to it.
- **What a user still cannot do anywhere:** review on a phone. Deleting the CLI does not change that, and it remains the larger gap.

## Source

Discussion in session, from "I'm not sure the CLI makes sense — they are flash cards", after a session spent fixing a CLI-only key-handling bug and pricing a harness for the loop that bug lived in. The case for keeping the non-interactive half was made and overruled; it is recorded above as the option to revisit first.
