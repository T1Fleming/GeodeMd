# Review flow

```ts
getDueCards(now: Date, limit = 50): DueCard[]
countDue(now: Date, limit: number): number
reviewCard(cardId: string, rating: 1|2|3|4, now: Date): Promise<CardState>
stats(now: Date, limit: number)
```

`reviewCard` returns the state it computed. A caller needs it to know that the scheduler wants this card again in ten minutes ([ADR 0023](../decisions/0023-honour-short-term-learning-steps.md)); recomputing it outside would mean a second copy of the fold.

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

**That join is also why the count is capped.** It probes `cards` once per due row, so the cost is proportional to the size of the *due set* — a number the user's habits set, not the collection's size. Measured at a million cards with 389,000 due, it was 205 ms, and `stats` asks for two of these plus a count of the new cards: 632 ms of frozen main process for four numbers ([ADR 0024](../decisions/0024-remeasure-the-main-process-stall.md)). Every count that can grow without bound now stops at a limit and reports a floor, which `host`'s `countText` renders as `10000+`. The limit is `host`'s `COUNT_CAP` and `stats(now, limit)` takes it as an argument — the same rule as `now`: `core` reads no policy of its own. `countCards` is the exception: a total is a fact about the collection rather than about a backlog.

### Two consequences worth knowing in advance

**Due cards are served ahead of new ones**, so a backlog larger than `limit` starves new cards completely until it clears. That is the intended trade — recovering what you already half-know beats piling on more — and the escape hatch is another sitting (the "Review more" button, ADR 0025), not a scheduling rule.

**Pruning happens in `sync`, and `review` does not run one.** A note deleted after the last sync leaves its cards in the queue until the next `sync`. Making `review` walk the tree first would charge every session a full walk — tolerable at twenty thousand files, not at a hundred thousand — to avoid being asked about a card you deleted. `sync` after editing is the contract.

The `50 of 1240 due` header comes from a separate `COUNT(*)` against the same index, not from the length of a fetched list — materializing the queue to count it would be far worse. The brief called the count "the cheap part", and at a large backlog it is not: see the cap above, and `10000+` in place of a number nobody needed exactly. There is deliberately no *persistent* daily-limit state, which would be durable state living outside the notes and the logs.

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
- **Legend:** `1 again  2 hard  3 good  4 easy   o open · a annotate · q quit` under the answer, and `0 later · q quit` under the question. FSRS's four ratings are not guessable from their numbers, and neither is `o`. Which keys belong to which stage is `ACTION_KEYS`'s `stage` field in `host` — both interfaces map it rather than deciding, and `boundaries.test.ts` enforces that.
- **`0` defers the card**, and is offered *only* before the answer is showing ([ADR 0022](../decisions/0022-defer-a-card-without-rating-it.md)). It records nothing — no log line, no FSRS fold, no write — and moves the card to the back of the queue. It is unavailable once the answer is on screen on purpose: deferring a card you have read the answer to would make the next sighting a sham test, and a card you could not recall is a lapse that `1` already describes honestly.
- **`o` opens the card's note at its line**, offered only once the answer is showing. See [ADR 0012](../decisions/0012-open-the-note-from-review.md).
- **Which program opens it comes from `host/editor.ts`**, not from the renderer — one table for `resolveEditor`, `editorCommand` and the line flags. The spawn is the app's, and it detaches rather than waiting: a GUI must not block for as long as a note stays open. See [the module map](module-map.md).
- **At the end of the session, notes that changed are named.** Every note opened is recorded with the mtime it had at the time, and the comparison happens once, when the session ends — not when the editor returns. Only a terminal editor holds the process until you quit it; `code`, `subl` and every OS opener return in milliseconds, so checking around the spawn would report nothing in exactly the setup where the user is most likely to still be typing. The queue is a snapshot, so a note edited mid-session is stale on screen, and this line is the only thing that says so.
- **`a` opens the card's annotation**, and only once the answer is showing ([ADR 0029](../decisions/0029-annotations.md)). An annotation may restate the answer, so showing it at the question would make the review a sham test — the mirror image of `0`. At the question `a` does nothing at all, not even the reveal any other key performs. The panel is never opened automatically; a small marker under the answer says when a card has one. Whether it has one is a fetch on reveal (`annotation/get`), not a field on `DueCard`, so the queue costs no `stat` per card.
- **Annotating is a session state** (`Session.annotation`, `annotating()` in `renderer/model/session.ts`). While the box is open every key is text: `1`–`4`, `q`, `0`, `o` and `a` do nothing and produce no effect, and the document listener lets them through to the text box instead of calling `preventDefault`. Only two keys are the session's, and `host`'s `interpretAnnotatingKey` says which: **`Escape` and Cmd+Enter both save and close** — `Escape` does not quit here, and it saves rather than discards because losing typed text is the worse surprise. An unchanged box closes without a write. A failed save keeps the box open with the text in it and says why. Leaving the review tab with the box open saves too. **A vault switch saves an open box first and waits** (`Review`'s flush, gated by `mayLeave`); if that save fails the switch is abandoned and the box keeps the text and the error. `a` is inert until the fetch on reveal has answered, so a box can never open empty over an annotation that has not arrived and then overwrite it.
- **A card on a learning step comes back in the same session.** Our pinned parameters have `enable_short_term` on, so a new card rated `1` is due in 1 minute, `2` in 5, `3` in 10, and only `4` graduates; a Review card rated `1` goes to Relearning 5 minutes out. Those due dates are honoured rather than discarded — see [the queue](#the-queue) below and [ADR 0023](../decisions/0023-honour-short-term-learning-steps.md).

### Raw mode

Single keypresses mean raw mode, and three things follow:

- **Require a TTY.** If `process.stdin.isTTY` is false — piped input, cron, CI — exit non-zero with `review requires an interactive terminal`. A line-buffered fallback that half works is worse than a clear refusal.
- **Restore the terminal on every exit path.** The mode restore lives in a `finally`, and a `SIGINT` handler restores it and exits 0. A process that dies in raw mode leaves echo off, which reads as a broken shell rather than a quit — and by the log-first rule every rating already given is safe, so a clean exit is honest.
- **Ignore `SIGINT` while an editor is running.** A Ctrl-C aimed at `vim` reaches this process too.

### Presentation

`render.ts` builds the strings; `style.ts` holds the terminal primitives, hand-rolled rather than taken as a dependency.

Card text is wrapped to a column rather than to the window, the locator and legend are dimmed, and the counter (`2/12`) repeats on every card — the `50 of 1240 due` line printed once at the top is no help by card thirty. Colour is off when `NO_COLOR` is set, when `TERM` is `dumb`, and when stdout is not a TTY.

None of this is a redraw. The output stays append-only, so the session's scrollback survives it.

## The queue

**It lives in `host/queue.ts`, not in either interface.** When a rated card comes back, whether it jumps ahead of an unseen one, and what happens when the only card left is due in forty seconds are decisions, and two interfaces answering them apart would each stay self-consistent while disagreeing about what a session is. `boundaries.test.ts` greps for `inShortTermSteps` outside `host`.

A card is in one of three places: **fresh** (not yet answered, in the snapshot's order), **waiting** (answered, owed again inside this sitting, earliest due first), or **in flight** (answered, with the scheduler's answer not back yet — the renderer learns a new due time from an IPC round trip that resolves after the keypress).

What to show, at the instant a key is pressed:

1. **A waiting card whose time has come**, ahead of anything unseen.
2. Otherwise **the next fresh card**.
3. Otherwise **the earliest waiting card, early** — nothing else is left, so showing it beats idling.

Three properties follow, and each is load-bearing:

- **The session never waits.** No timer fires; rule 3 is what makes that true.
- **The clock is read on a keypress, never while drawing.** A card that ripened mid-read must not replace the one being read, or the next rating lands on a card nobody looked at.
- **The session is over when nothing is owed**, which is not the same as "nothing to show right now". A card in flight is still owed, so rating the last card cannot end the session before its answer arrives — it may be "show it again in a minute".

Which cards come back is a **state** test — `Learning` or `Relearning`, the scheduler's own instruction — rather than "due within N minutes", which would be ours. `host/queue.test.ts` asserts that the pinned parameters keep those states minutes away, so the two cannot drift apart silently.

**`0` reorders it and records nothing.** A deferred card goes behind the fresh ones wherever it came from; a waiting card deferred that way loses its step, which is correct because it had already ripened or it would not have been on screen. Deferring the only unseen card hands it straight back rather than pulling a waiting card early — the back of the unseen cards is somewhere a card can always be served from, where "behind the waiting cards too" would let a card that keeps failing starve it for the rest of the session.

**The counter counts answers, not cards.** `3 / 24` after `3 / 23` is a second look being earned, not a bug: the denominator is answers given plus answers owed, and a card on a learning step owes one.

## Stats

`due` is an instant, so "due today" is ambiguous. `stats` reports **due now** as the actionable number, with *due before local midnight* as a separate forecast line, alongside total and new.
