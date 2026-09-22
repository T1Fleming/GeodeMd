# 0021 — No built-in sync transport; carry the notes directory

- **Status:** Accepted
- **Date:** 2026-09-20
- **Supersedes:** [0014](0014-cross-device-sync-transport.md)

## Context

[ADR 0014](0014-cross-device-sync-transport.md) left the transport open and said what would settle it: *whether the notes directory is expected to be synced by something the user already runs, or by this tool itself.* It also named the one thing a transport would have to add — conflict-copy filtering — and the constraint that ruled on the third option, [ADR 0013](0013-cli-and-electron-are-peers.md).

Two things have changed since, and both narrow the question rather than answer it directly.

**The coupling is gone.** [ADR 0019](0019-report-sync-conflict-copies.md) shipped conflict-copy handling *without* naming a transport: the patterns that matter are recognised, the files are left alone, and the count is reported. That was the load-bearing reason the decision had to come first, and it no longer applies.

**The premise is now tested rather than argued.** `src/core/two-devices.test.ts` runs two machines — two databases, two device names, one notes directory — and checks what had only ever been designed:

- they agree on card identity with no negotiation, because the stamp in the note *is* the identity
- they write to separate log shards, so no file is ever merged by anything
- each picks up the other's reviews on the next ingest
- they converge on **identical** scheduling state, not merely on both having some
- re-ingesting the same shards reports `0 reviews ingested` and changes nothing
- replay follows `rated_at`, not arrival order
- a third machine with an empty database arrives and matches the others exactly
- a machine that deletes its database and rebuilds is indistinguishable from one that did not

These are the properties a transport would otherwise have to provide. They are provided by the file format.

## Decision

**GeodeMD ships no transport.** The unit of sync is the notes directory, and the user moves it with whatever they already use — a file syncer, git, or a USB stick.

**The service option is rejected**, not deferred. Three reasons, in order of weight:

1. [ADR 0001](0001-plain-text-is-the-durable-store.md) makes the user's own plain text the durable store. A service means their notes or their review history living somewhere they do not control, which is the premise of the tool inverted.
2. [ADR 0013](0013-cli-and-electron-are-peers.md) requires the CLI to be a peer, so a service needs a headless client too — the work doubles and the CLI gains a network dependency it has no other reason to have.
3. It buys nothing the file format does not already provide, as the tests above now demonstrate rather than assert.

**Neither a file syncer nor git is blessed over the other**, because nothing in the code distinguishes them. git has one real advantage worth recording: two machines write to two different shard files, so a merge is never even attempted — there is no conflict to resolve, and consequently no conflict copy for ADR 0019 to catch.

## The one rule this cannot remove

**Stamp on one machine, let it propagate, then set up the second.**

If two machines each run a *first* sync on the same unstamped notes before exchanging anything, each mints its own ids for the same lines. Neither is wrong; neither has anything to agree with.

The cost is worth stating precisely, because the intuitive guess is wrong. It does **not** duplicate the cards — whichever copy of the note wins the merge carries one set of ids and the other set is pruned when it stops appearing. What is lost is the *history recorded against the losing ids*: still in the log, still durable, now pointing at cards that no longer exist. A test pins exactly this.

No transport fixes it. A service would not either, unless it minted ids centrally — which would make a running server a prerequisite for writing a card, and that is a worse trade than the rule.

## Consequences

Cross-device sync is documentation, not code. [`docs/guides/moving-notes.md`](../guides/moving-notes.md) is the deliverable.

A user with no sync tool has no sync. That is the honest position for a tool whose durable store is a directory of their files, and it is the same position `git` takes.

It also settles a question [ADR 0015](0015-accept-clock-skew.md) left hanging. That ADR rejected server-assigned timestamps partly because a server "[ADR 0014] has not chosen and may never" — this is the never. Ordering stays the recording machine's clock, and a badly wrong clock stays a permanent, documented limitation rather than something a future server might fix.

Revisiting this needs a new ADR and a reason the file format cannot already meet. The likeliest candidate is not technical: someone who wants sync without running anything. If that user is worth serving, ADR 0013 says they must be served on the command line too.

## Source

Issue-free: this closes out [ADR 0014](0014-cross-device-sync-transport.md), the last ADR still marked Proposed. The evidence is `src/core/two-devices.test.ts`, written for this decision.
