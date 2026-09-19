# 0011 — Enumeration is a seam: walk now, snapshot later

- **Status:** Accepted
- **Date:** 2026-09-19 (backfilled)
- **Source:** plan.md §1, §8 step 1

## Context

A full walk is the only way to notice a deletion, and no cache removes that — absence is the only signal a deletion leaves. So enumeration cost is linear in **file count**, and file count is the axis the scale target cares about most.

A resident daemon or file watcher would avoid the walk, but "any resident daemon or live/reactive behaviour" is an explicit non-goal.

## Decision

Phase 1 walks the tree recursively, sorting directory entries so the order is deterministic across machines and filesystems. It skips any dotted directory (covering `.git/`, `.sr/`, and whatever an editor leaves behind, without naming any of them), non-`.md` files, and **directory symlinks**.

**Step 1 is declared a seam**: it is the only part of the design that knows how changes are discovered, and everything downstream consumes a list. `@parcel/watcher`'s `writeSnapshot` / `getEventsSince` is a drop-in alternative that on macOS answers from FSEvents' kernel-cached history without touching the tree — no daemon, no resident process, still entirely on demand, which is why it would not violate the non-goal.

That swap is **pre-authorized but not to be built speculatively.** A warm walk at a million files costs under two seconds, and a second native module carries the same ABI-pinning cost as `better-sqlite3`.

## Consequences

- Directory symlinks are not followed, and are counted in the summary. Whether a walk follows one is otherwise decided by an implementation accident — recursing on `dirent.isDirectory()` does not, recursing on `statSync().isDirectory()` does — and the consequence is not cosmetic: a followed symlink presents one file at two paths, the second visit sees every ID as already-seen and re-mints all of them, and the card's identity churns on every sync, stranding its history each time.
- Tracking inodes to de-duplicate instead is the more "correct" answer and was rejected as not worth it: it buys support for a layout the user can also get by moving the folder in.
- The remaining open question is the **cold** cache number, which is unmeasured and plausibly an order of magnitude worse than warm. That is the one number that could still change this decision, which is why the seam exists rather than being deferred to a rewrite.
