# 0005 — Review history is an append-only JSONL log, sharded per device per month

- **Status:** Accepted
- **Date:** 2026-09-19 (backfilled)
- **Source:** plan.md §5a

## Context

[0001](0001-plain-text-is-the-durable-store.md) makes the database derivable, which means the one thing that genuinely cannot be reconstructed from anywhere else — the history of what was rated when — has to live in plain text in the notes directory.

## Decision

One append-only JSONL file **per device per month**, at `<notes>/.sr/log/<device>-YYYY-MM.jsonl`. One line per review:

```json
{"card":"sr-a7Kd9mQ2xR4v","at":"2026-09-02T18:41:07.324Z","rating":3,"elapsed":12.1,"scheduled":21.4}
```

**Per device**, because the invariant is one writer per file. A file promised never to be rewritten should never need renaming either, so naming it after the machine that writes it makes a second machine additive rather than a migration.

**Per month**, because of scale. Ten million lines is roughly a gigabyte; as one file that is a single object every backup re-transfers whole, and as monthly shards it is a few dozen files of which exactly one is ever open for writing. A frozen shard whose recorded size matches its size on disk is skipped without being opened.

Supporting rules:

- `at` is **always** ISO-8601 UTC with exactly three fractional digits and a trailing `Z`. Fixed-width UTC sorts lexicographically, so ordering is free in both SQL and JS — but mixing precisions silently breaks it, since `Z` sorts after `.`. The log is never rewritten, so a format change later leaves the directory permanently holding both shapes.
- `reviewCard` appends to the log **first**, then updates SQLite. A crash between the two leaves a review in the log and not the database, and the next ingest folds it in. The reverse order loses data.
- Append with `O_APPEND`, one `write()` per review, and `fsync` before touching SQLite. This is a loop paced by a human pressing keys, so the cost is irrelevant and the difference is surviving a power loss rather than only a killed process.
- Uniqueness is `(card_id, rated_at)`. **`device` is descriptive, never part of identity** — otherwise a duplicated line replays a card with its reviews counted twice, producing silently wrong stability on top of an uncorrupted log.
- Ingest reads **every** `.jsonl` in the directory whatever it is named, because skipping an unfamiliar file can only lose data while reading it costs nothing.
- A line that fails to parse is skipped and counted, never fatal — the expected malformed line is a truncated final line from exactly the crash the write-first ordering exists to survive.

## Consequences

- Ingest is idempotent, which makes the `log_files` offset cursor an optimization rather than a correctness dependency. Delete it and the next ingest re-reads every shard and arrives at the same state.
- `O_APPEND` with one-line writes far under `PIPE_BUF` is why two concurrent processes interleave whole lines, and why no lock file is needed.
- `elapsed` and `scheduled` are recorded for a future optimizer and **no code path reads them back**, which is what makes replay a pure function of (card ID, `at`-ordered ratings). They are omitted on a first review rather than written as `0`, which would be a fabrication the optimizer reads as fact.
- This layout is most of what cross-device sync would need, without phase 1 building any of it.
