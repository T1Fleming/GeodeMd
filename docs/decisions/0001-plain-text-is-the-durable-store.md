# 0001 — Plain text is the durable store; SQLite is a derivable cache

- **Status:** Accepted
- **Date:** 2026-09-19 (backfilled)
- **Source:** plan.md §1, §5

## Context

A spaced repetition system has two kinds of state: what the cards say, and what happened when they were reviewed. The default design puts both in a database and treats the user's notes, if there are any, as an import source. That makes the database the thing you must never lose, and it makes the tool's survival a precondition for the user's data staying meaningful.

The goal here was the opposite: if this program disappears, the directory should still be an ordinary folder of Markdown files.

## Decision

Everything durable is plain text inside the notes directory.

- **Card content** lives in the user's notes, as the lines they wrote.
- **Review history** lives in `<notes>/.sr/log/`, as append-only JSONL.
- **Everything else** is SQLite, placed *outside* the notes directory, and holds nothing that is not derivable from the two above.

Every column in the schema is checked against one property: it must be a function of the notes or the logs. `cards` and `files` derive from the notes; `reviews` and `log_files` derive from the logs; `card_state` derives from replaying `reviews`.

## Consequences

- `rebuild` must be *total* — drop every table, re-walk, re-ingest, and arrive at a byte-identical database. It is a plain sync against an empty database rather than a separate code path, which is the only reason it can be trusted to keep working.
- The rebuild test can assert full-table equality with no carve-outs. No column is exempt, which is what makes the durability claim checkable rather than aspirational. See [0010](0010-absence-is-not-deletion.md) for what that totality cost us and why it was worth it.
- The database must never be placed inside the notes directory. It is the single worst kind of file to put under a sync or backup tool, and it drags `-wal` and `-shm` along with it.
- At the top of the scale target a rebuild is minutes, not milliseconds. It is the recovery path, not a routine one.
