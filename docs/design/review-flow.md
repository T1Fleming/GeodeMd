# Review flow

```ts
getDueCards(now: Date, limit = 50): DueCard[]
countDue(now: Date): number
reviewCard(cardId: string, rating: 1|2|3|4, now: Date): Promise<void>
stats(now: Date)
```

## Building the queue

`getDueCards` runs two indexed queries and concatenates them, taking `limit` in total. Neither sorts the collection.

```sql
-- Due, most overdue first. Uses idx_state_due.
SELECT c.id, c.question, c.answer, c.file_path, c.line_no
  FROM card_state s JOIN cards c ON c.id = s.card_id
 WHERE s.due <= :now
 ORDER BY s.due
 LIMIT :n;

-- New, in the order they read in the notes. Uses the partial idx_cards_new.
SELECT id, question, answer, file_path, line_no
  FROM cards
 WHERE reviewed = 0
 ORDER BY file_path, line_no
 LIMIT :remaining;
```

The second query is why `cards.reviewed` exists. As an anti-join against `card_state` it is correct but degrades linearly with the number of *reviewed* cards — the number that grows. Against the partial index it is a range scan of exactly `:remaining` rows whatever the collection holds.

Ordering is deterministic and testable. No randomization, no burying, no sibling logic, no daily limits.

`countDue` joins `card_state` to `cards` rather than counting state rows alone. `card_state` deliberately outlives the card it belongs to, so counting state alone reports cards that no longer exist and `stats` could print due + new greater than total.

### Two consequences worth knowing in advance

**Due cards are served ahead of new ones**, so a backlog larger than `limit` starves new cards completely until it clears. That is the intended trade — recovering what you already half-know beats piling on more — and the escape hatch is a larger `-n`, not a scheduling rule.

**Pruning happens in `sync`, and `review` does not run one.** A note deleted after the last sync leaves its cards in the queue until the next `sync`. Making `review` walk the tree first would charge every session a full walk — tolerable at twenty thousand files, not at a hundred thousand — to avoid being asked about a card you deleted. `sync` after editing is the contract.

The `50 of 1240 due` header comes from a separate `COUNT(*)` against the same index, not from the length of a fetched list: at a million cards the count is the cheap part and materializing the queue would not be. There is deliberately no *persistent* daily-limit state, which would be durable state living outside the notes and the logs.

## Recording a review

`reviewCard` appends one line to this device's current monthly log file, `fsync`s it, then inserts into `reviews`, upserts `card_state`, and sets `cards.reviewed = 1` in a transaction.

**The log write comes first.** A crash between the two leaves the database behind by one review, which the next ingest repairs; the reverse order loses the review outright.

**A busy database is not an error worth ending a session over.** WAL allows one writer, so a `reviewCard` issued while a long `sync` or `rebuild` holds the write lock will exhaust the busy timeout and fail. By then the rating is already `fsync`ed into the log, so the failure is exactly the condition the next ingest repairs: catch `SQLITE_BUSY`, print `database busy; reviews are in the log and will sync later`, and keep going.

This is also why the busy timeout stays at a few seconds rather than being raised to cover a rebuild — blocking the user behind a minutes-long write lock is worse than proceeding.

## Implicit ingest

`review` and `stats` first run [sync](sync.md) **step 7 only** — ingest the logs and replay — and nothing else. On one machine it is usually a no-op, and with the `log_files` cursor it is a `stat` per shard rather than a re-read, so it costs milliseconds even when the log holds ten million lines.

It repairs the one-review gap left by a crash, it keeps the ingest path exercised every session rather than only during `rebuild`, and it is the only thing a second machine would need in order to work. Step 7 writes to SQLite but opens no note; the walk and the stamp writes stay exclusive to `sync`.

## The loop

Print question → any key → print answer → read `1`–`4` → record → next.

- **`q` quits from either state.** Any key reveals the answer *except* `q`, which quits there and then without recording; it is the one key the "any key" rule excludes.
- **Legend:** `1 again  2 hard  3 good  4 easy   o open · q quit` under the answer, and `0 later · q quit` under the question. FSRS's four ratings are not guessable from their numbers, and neither is `o`. Which keys belong to which stage is `ACTION_KEYS`'s `stage` field in `host` — both interfaces map it rather than deciding, and `boundaries.test.ts` enforces that.
- **`0` defers the card**, and is offered *only* before the answer is showing ([ADR 0022](../decisions/0022-defer-a-card-without-rating-it.md)). It records nothing — no log line, no FSRS fold, no write — and moves the card to the back of the queue. It is unavailable once the answer is on screen on purpose: deferring a card you have read the answer to would make the next sighting a sham test, and a card you could not recall is a lapse that `1` already describes honestly.
- **`o` opens the card's note at its line**, offered only once the answer is showing. See [ADR 0012](../decisions/0012-open-the-note-from-review.md).
- **Both interfaces open it the same way.** Which program to run, and how it is told a line, come from `host/editor.ts` — one table, so `o` cannot mean `code --goto` in the terminal and "whatever owns `.md`" in the app. What differs is the spawn: the CLI inherits the TTY and waits, the app detaches and returns at once. See [the module map](module-map.md).
- **At the end of the session, notes that changed are named.** Every note opened is recorded with the mtime it had at the time, and the comparison happens once, when the session ends — not when the editor returns. Only a terminal editor holds the process until you quit it; `code`, `subl` and every OS opener return in milliseconds, so checking around the spawn would report nothing in exactly the setup where the user is most likely to still be typing. The queue is a snapshot, so a note edited mid-session is stale on screen, and this line is the only thing that says so.
- **A card rated `1` is not re-shown in the same session.** The queue is materialized once, and FSRS puts a lapsed card a minute or so out, so it returns on the next `geode review`. Re-queueing inside the session is learning-steps logic, which is out of scope.

**The queue is a working copy.** `0` reorders it, so the loop is index-driven in both interfaces rather than iterating the snapshot; the length never changes, and a deferred card is still owed an answer, so the session ends only when every card has one or the user quits.

**Not yet honoured: FSRS's learning steps.** Our pinned parameters have `enable_short_term` on, so a new card rated `1` is due in 1 minute, `2` in 5, `3` in 10 — every new card answered anything but *easy* is already scheduled to return in the same sitting. The queue is a snapshot, so those due dates are computed and then discarded until the next session. Honouring them is Anki's behaviour and remains open; [ADR 0022](../decisions/0022-defer-a-card-without-rating-it.md) explains why `0` is complementary to that rather than a substitute for it.

### Raw mode

Single keypresses mean raw mode, and three things follow:

- **Require a TTY.** If `process.stdin.isTTY` is false — piped input, cron, CI — exit non-zero with `review requires an interactive terminal`. A line-buffered fallback that half works is worse than a clear refusal.
- **Restore the terminal on every exit path.** The mode restore lives in a `finally`, and a `SIGINT` handler restores it and exits 0. A process that dies in raw mode leaves echo off, which reads as a broken shell rather than a quit — and by the log-first rule every rating already given is safe, so a clean exit is honest.
- **Ignore `SIGINT` while an editor is running.** A Ctrl-C aimed at `vim` reaches this process too.

### Presentation

`render.ts` builds the strings; `style.ts` holds the terminal primitives, hand-rolled rather than taken as a dependency.

Card text is wrapped to a column rather than to the window, the locator and legend are dimmed, and the counter (`2/12`) repeats on every card — the `50 of 1240 due` line printed once at the top is no help by card thirty. Colour is off when `NO_COLOR` is set, when `TERM` is `dumb`, and when stdout is not a TTY.

None of this is a redraw. The output stays append-only, so the session's scrollback survives it.

## Stats

`due` is an instant, so "due today" is ambiguous. `stats` reports **due now** as the actionable number, with *due before local midnight* as a separate forecast line, alongside total and new.
