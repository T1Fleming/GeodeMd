# Testing strategy

Do not aim for coverage. Test the five places where bugs are expensive, plus one harness that guards the scale properties.

The full suite runs in about a second, so there is no speed reason to run a subset.

## The five expensive places

**Parser** (`src/parser/parser.test.ts`) — fixture strings in, expected cards out. Covers each skipped context, `foo::bar` without spaces, already-stamped lines, multiple cards per file, `::` in answer text, list-marker and task-box prefixes, an empty side, and a line ending in some *other* HTML comment.

**Sync** (`src/core/sync.test.ts`) — against a temp directory and an in-memory database. Covers: a rename preserves state, edited text preserves state, stamping is idempotent across two runs, a deferred file mints nothing, a duplicated stamped line is re-minted **and its stamp replaced rather than appended to**, a duplicate inside a *deferred* file is skipped, a card copied to a second file is re-minted while one *moved* keeps its ID, a CRLF file differs from its original by exactly the stamped line, a symlinked directory is not descended into, and a missing `notesPath` exits non-zero rather than reporting a zero-card success.

**Incremental sync** (`src/core/scale.test.ts` and `sync.test.ts`) — the machinery whose failures are silent. A no-change sync writes nothing at all; `--dry-run` writes neither stamp nor row and still reports accurately; an unchanged file is not opened on the second run and a changed one is; `--full` reads both; a deleted file triggers the reconciliation pass and an unchanged tree does not; a stamp write records the post-write mtime; an unchanged log shard is not opened; a truncated final line leaves the offset before it so the completed line is ingested next run.

**Prune** — a deleted file removes its `cards` rows but leaves `reviews` and `card_state` untouched; restoring the file re-inserts the rows and the cards come back **due on their original schedule and not queued as new**. That second assertion is the one that proves `reviewed` was restored from `card_state` rather than defaulted.

**Rebuild** (`src/core/rebuild.test.ts`) — the test that protects the durability claim. Review some cards, delete the database, rebuild, and assert `cards`, `reviews`, `card_state` and `files` are **identical, in full**. No column is exempt and no row set is scoped.

That total assertion is what removing the tombstone columns bought ([ADR 0010](../decisions/0010-absence-is-not-deletion.md)), and it carries two further jobs for free. It catches `cards.reviewed` drifting out of agreement with `card_state`. And because the original state was built incrementally (fold-forward) while the rebuild is from-scratch, it is already a differential test between [sync](sync.md) step 7's two replay strategies.

It rests on the pinned scheduler parameters: **read a failure here as scheduler nondeterminism before assuming it is an ingest bug.**

## The boundaries test

`src/boundaries.test.ts` asserts the module rules by scanning source text — see [module-map.md](module-map.md). It is a test, not a compile step; `npm run build` will happily compile a violation.

## The scale harness

Asserts **shape, not seconds**. Wall-clock ceilings are machine-dependent: they pass on a laptop, fail in CI, and then someone raises the ceiling until it means nothing.

The single most important assertion is not a time at all: **a sync that finds nothing changed performs zero writes.** It holds at every scale, so it costs nothing to check on a tiny tree, and it is the one that silently regresses the moment someone adds innocuous bookkeeping.

Then the ratios. A synthetic tree at two sizes asserts a no-change sync scales roughly linearly with **file count**; holding file count fixed and multiplying cards-per-file asserts the no-change time stays **flat** — which fails the moment a per-card cost re-enters a path that should be one `stat` and one indexed read per file. `getDueCards` against a small and a large `card_state` must also be flat. A single-file change must read exactly one file, and deleting a file must be the only thing that triggers the reconciliation pass.

All of it stays small enough to run in the default suite, because a suite people stop running guards nothing.

## What is deliberately not automated

Two measurements decide open questions rather than guard invariants, and both must record **cold and warm separately** rather than pretending there is one number: a large-tree enumeration (which decides whether [sync](sync.md) step 1 stays a walk), and a million-review rebuild (which decides whether the bulk-load escape hatch is needed).

Dropping the filesystem cache needs `sudo purge` on macOS, so these are commands a human runs, not something CI can fake. **The enumeration one has now been run** — see [sync.md](sync.md#cold-cache); cold cost 1.09× warm, which settled the question rather than reopening it.

Doing it correctly has one trap worth writing down: **the tree must already exist on disk before the purge.** A benchmark that builds its own tree and then measures it has warmed the cache for precisely the files it is about to read, and the "cold" number is fiction. Build first, purge, then measure in a single run — the second run is warm again.

The enumeration one is now written — `src/files/enumerate.bench.test.ts`, gated so the default suite never runs it:

```sh
GEODE_BENCH=1 npx vitest run src/files/enumerate.bench.test.ts
GEODE_BENCH=1 GEODE_BENCH_FILES=80000 npx vitest run src/files/enumerate.bench.test.ts
GEODE_BENCH=1 GEODE_BENCH_TREE=/path/to/a/real/vault npx vitest run src/files/enumerate.bench.test.ts
```

It runs every strategy in **one process against one tree**, because the figures that turned out to be wrong came from a different machine on a different day. It uses two tree shapes — 100 files per directory and 4 — because the narrow one is what a vault of topic folders looks like and is where per-directory concurrency collapses; reporting only the wide shape would be the flattering version of the benchmark. Median of five runs after a discarded warm-up, since one page-cache miss skews a mean.

**The file-descriptor question is deliberately not a test.** A bounded pool cannot exhaust descriptors by construction, a suite that must stay around a second cannot prove it honestly, and mocking `fs` would contradict a repo that has no mocks anywhere. Run the suite under `ulimit -n 128` by hand instead — that is the available evidence, and it passes.
