# 0014 — Cross-device sync transport

- **Status:** Proposed
- **Date:** 2026-09-19

## Context

Phase 1 is one machine. The log layout was nonetheless built so that a second machine is **additive rather than a migration**, and the properties that make that true are already shipped:

- append-only shards that are never rewritten, one writer per file
- `(card_id, rated_at)` as a dedupe key, so re-ingesting anything is a no-op
- fixed-width UTC timestamps that sort lexicographically
- `device` recorded in every line but never part of a review's identity
- ingest that reads *every* `.jsonl` in the log directory, whatever it is named
- replay ordered by `rated_at` rather than by arrival

Monthly sharding helps too: a frozen shard never changes, so a file syncer transfers each one exactly once.

None of that picks a transport, and the choice is genuinely open.

## Options

**A file syncer** — Syncthing, Dropbox, iCloud Drive. The notes directory is already the unit of sync, and many users already sync it for reasons unrelated to this tool.

**git** — technical notes are frequently in git already, and the brief's own advice at `init` is to commit the notes directory first.

**A service the Electron app talks to.**

## Decision

**None yet.** This ADR exists because the *undecided* choice already constrains the shipped code, and that constraint is currently written down nowhere outside the retired brief.

## What already binds, before anything is chosen

**Conflict-copy filtering belongs to the transport, and it is the one thing a transport must add.** The dedupe key protects the *log*; it does nothing for *notes*. A duplicated note has no identity of its own, so enumeration reads it as a new file and mints a fresh card for every stamped line in it — then writes those stamps into the copy. The patterns are tool-specific: Syncthing writes `*.sync-conflict-*`, Dropbox writes `(conflicted copy)`. Which pattern to skip in [sync](../design/sync.md) step 1 is not knowable until the transport is known, which is exactly why it was left out of phase 1.

**This is not purely a future problem.** Anyone already syncing their notes directory with Dropbox or Syncthing today can produce a conflict copy, and today's enumeration will happily read it. If that turns out to be reachable in practice, a defensive skip may be worth adding *ahead* of this decision rather than as part of it.

**[ADR 0013](0013-cli-and-electron-are-peers.md) narrows the third option.** If the transport is a service the Electron app talks to, then syncing becomes a GUI-only capability and the CLI is demoted to a second-class interface — which is precisely what 0013 says will not happen. That option therefore needs either a headless client usable from the CLI, or rejection.

**Clock skew is not fixed by any of them.** See [ADR 0015](0015-accept-clock-skew.md); a transport moves reviews between machines but cannot repair the order they were recorded in.

## What would settle it

Whether the notes directory is expected to be synced by something the user already runs (favouring a file syncer or git, where this tool adds only a filter) or by this tool itself (favouring a service, with everything that implies about hosting, accounts and the CLI's access to it).

Until that is answered, phase 1 forecloses none of the three.
