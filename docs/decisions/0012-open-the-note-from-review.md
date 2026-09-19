# 0012 — Review can open the note, and detects edits by an end-of-session sweep

- **Status:** Accepted
- **Date:** 2026-09-19 (backfilled)
- **Source:** [phase-1 brief](../design/phase-1-brief.md) §9

## Context

Every card shows its locator — `algorithms/Sorting.md:142`. That is a promise that you can get back to where you wrote something. Making the user honour it by hand, in another window, costs them the session.

Meanwhile `review` deliberately does not walk the notes ([0008](0008-incremental-sync-costs-what-changed.md)), so the queue holds the text from the last `geode sync`. A card edited mid-session is stale on screen and nothing would otherwise say so.

## Decision

`o` opens the card's note at its line, offered only once the answer is showing. Editor precedence is config `editor`, then `$VISUAL`, then `$EDITOR`, then the platform opener.

**Edits are detected by recording each opened note's mtime and sweeping them all once at the end of the session**, naming what changed — not by comparing mtimes around each spawn.

## Rationale

Checking at the end rather than when the editor exits is the whole point, not an implementation shortcut. **Only a terminal editor holds the terminal until you quit it.** `code`, `subl`, `zed` and every OS opener hand the file to an already-running instance and return in milliseconds, before anything has been typed. An mtime comparison bracketing the spawn therefore reports nothing in precisely the setup where the user is *most* likely to keep editing while the session runs. One sweep at the end is correct for both shapes, and "run `geode sync`" is a post-session action anyway.

## Consequences

- Nothing goes through a shell. The `editor` value is split on whitespace rather than shell-parsed, and Windows uses `rundll32 url.dll,FileProtocolHandler` rather than `cmd /c start`, because `cmd.exe` re-parses its arguments and Node quotes one only when it holds a space, tab or quote — a note named `note&calc.md` would otherwise reach a shell with its `&` intact.
- The line number is passed only in the form the named editor understands (`+142`, `--goto file:142`, `file:142`) and **omitted entirely for an unrecognised editor**, because handing an unknown program `+142` risks creating a file by that name.
- Three consequences of spawning with the terminal inherited, all easy to get wrong: drop out of raw mode around the spawn and wait for the child; **ignore `SIGINT` while it runs**, since a Ctrl-C aimed at `vim` reaches this process too; and reprint the card afterwards, because the editor has scribbled over it and a rating should be given against something still on screen.
- `editor` is the config's only optional key and `init` never writes one — absent means "fall through", which is a better answer than any value `init` could invent on a machine it knows nothing about.
