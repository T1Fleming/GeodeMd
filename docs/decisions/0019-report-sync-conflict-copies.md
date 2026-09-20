# 0019 — Report a syncer's conflict copy rather than syncing it

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

A file syncer that cannot merge two versions of a note resolves the collision by writing a second file beside the first:

```
notes/aws/lambda.md
notes/aws/lambda.sync-conflict-20260101-120000-ABCDEFG.md
notes/aws/lambda (conflicted copy 2026-01-01).md
```

Enumeration read it as an ordinary new `.md` file. Because the copy is byte-identical, every card in it already carries a stamp — so [section 4](../design/parser.md)'s copy-versus-move check found each id still present in the original, correctly classified it as a **copy**, and minted a fresh id **into the conflict file**.

The result was a duplicate of every card in that note, each with its own empty history, sitting in the review queue. Nothing was lost — the original is untouched and its history intact — but the user reviews everything twice until they notice, and the duplicates now carry their own review history, so noticing late costs more than noticing early.

**The log's dedupe key does not help.** `(card_id, rated_at)` protects the *log*: re-ingesting a shard is a no-op and two devices merge cleanly. Notes have no such key, and a duplicated note is indistinguishable from a note someone genuinely wrote by copying — a case the design deliberately supports.

[ADR 0014](0014-cross-device-sync-transport.md) named this and deferred it, on the grounds that which pattern to skip belongs to whoever chooses the transport, and phase 1 had not. That reasoning still holds for a *complete* answer. It does not hold for doing nothing, because the failure is reachable today by anyone whose notes directory is synced, and the user's first sign of it is duplicate cards.

## Options

**Skip the known patterns silently.** Smallest change. A user whose folder was quietly half-read has no way to find out why a note is missing from their collection, and the answer — "one of your files matched a pattern" — is not guessable.

**Report rather than skip.** Enumerate them, do not mint into them, and surface a count in `SyncSummary`: *"1 sync conflicts left alone"*. Fits the codebase's existing habit of counting what it skipped (`filesSkippedOnError`, `symlinkedDirsSkipped`, `filesDeferred`) rather than acting silently.

**Make it configurable.** Defers the pattern to the user. Adds a config key for a problem most users will never have, and requires them to know the answer before they have seen the symptom.

## Decision

**Report rather than skip.**

A conflict copy is enumerated — so step 6 does not read its absence as a vanished file — and then left entirely alone: not read, not parsed, not stamped, not reconciled. The count appears in the summary through `summaryFields`, so both interfaces show it without either one restating the policy.

Three details are deliberate:

**The count is reported on every sync, not only the first.** It is emitted before the mtime-cache check, so an unchanged conflict copy still reports. The situation persists until the user deals with the file, and a warning shown once is a warning that gets missed.

**Only distinctive patterns match.** Syncthing's `.sync-conflict-YYYYMMDD-HHMMSS-XXXXXXX.` and the `(… conflicted copy …)` form used by Dropbox and Nextcloud. Deliberately *not* matched: iCloud's `note 2.md`, Google Drive's `note (1).md`, OneDrive's `note-HOSTNAME.md`. Those are conflict markers for those tools and are also filenames thousands of people choose on purpose — and the two failures are not symmetric. Missing a conflict copy costs duplicate cards, which are visible and fixable. Matching an ordinary note means silently ignoring something the user meant to keep, which is neither.

Reporting is what makes the narrow patterns affordable: a false positive shows up as a line in the summary, in the one place the user is already looking.

**Nothing existing is deleted.** A collection that already has duplicates from a previous sync keeps them; this stops new ones. Cleaning up would mean deciding which of two cards holding the same question is the real one, and that is a judgement the tool does not have the information to make.

## Consequences

The failure is no longer reachable through the front door, and the situation has a name in the output.

A user who deliberately keeps a file named `notes (conflicted copy 2026-01-01).md` will find it ignored. They will also find it counted, which is the difference between a confusing tool and an explicable one.

This does not close [ADR 0014](0014-cross-device-sync-transport.md). Choosing a transport may add patterns, or may make the whole question moot by owning the conflict resolution itself. It narrows what that decision has to carry: the bug is contained, so the transport can be chosen on its merits rather than under pressure from this.

## Source

Issue #27. The reachability check that ADR 0014 asked for was run and was inconclusive — the machine's configured notes directory turned out to be a scratch vault, so it said nothing about real usage. The fix was taken anyway on the grounds that it is small, that packaging ([#25](https://github.com/T1Fleming/GeodeMd/issues/25)) puts the tool in front of people whose setups are unknown, and that the cost of being wrong here is a line of output nobody needed.
