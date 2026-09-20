# SQLite in WAL mode

Read while working out why a long write was blocking everything else.

What does WAL stand for :: write-ahead logging

In the default rollback-journal mode, a writer blocks every reader for the
duration of its transaction. WAL inverts that: writers append to a separate
file, and readers carry on against the last committed state.

- How many writers can WAL support at once :: exactly one
- What does WAL change about readers :: they no longer block, and are not blocked by, a writer

That "exactly one" is the part that matters in practice. Two processes writing
at the same time is not an error you can design away — one of them waits.

What does `busy_timeout` do :: makes a blocked writer wait that long before failing, instead of failing immediately

Which is the difference between a second process getting `SQLITE_BUSY` on the
first try and getting it only after genuinely waiting.

## Durability

- What does `synchronous = NORMAL` skip :: an fsync on every commit
- Why is that safe under WAL :: a crash can lose the most recent transactions but cannot corrupt the database

Worth pairing with somewhere else that *is* durable, which is roughly the
argument for writing an append-only log before touching the database at all.
