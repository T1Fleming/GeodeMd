/**
 * Reading the queue and the counts — which means ingesting the log first.
 *
 * `review` and `stats` run [sync step 7 only](../../../docs/design/review-flow.md#implicit-ingest):
 * ingest the logs and replay, and nothing else. No walk, no stamp. The CLI did
 * this before every session and every `stats`, and when the CLI was deleted
 * ([ADR 0025](../../../docs/decisions/0025-the-app-is-the-only-interface.md))
 * nothing was left doing it — so this is the app taking over a job it had been
 * quietly relying on the other interface to do.
 *
 * It does three things, and only the first is obvious:
 *
 * - **repairs the one-review gap** a crash leaves behind, since a rating is
 *   `fsync`ed to the log before SQLite is touched;
 * - **picks up another machine's reviews** the moment a syncer delivers its log
 *   shard, with no sync and no rebuild. Without it the app would show a card as
 *   due that was answered on the laptop an hour ago;
 * - **keeps the ingest path exercised** every session rather than only during a
 *   rebuild, which is where a silent regression in it would otherwise hide.
 *
 * Deliberately free of Electron imports, like `runs.ts`, so it is tested under
 * plain vitest against a real `Core` and a real temp collection.
 */

import { isSpot } from "../../core/index.js";
import type { Core, Counts, ReviewItem, SolveReview } from "../../core/index.js";
import { isBusy } from "../../host/errors.js";
import { startOfDay } from "../../host/present.js";

/**
 * Ingest, unless the database is busy.
 *
 * A long `sync` or `rebuild` holds the single write lock, and WAL allows one
 * writer — so an ingest issued during one exhausts the busy timeout and throws.
 * That must not cost the user their session: the reviews are in the log either
 * way, and the next read picks them up. Any *other* failure is a real one and
 * is left to the caller's `Result`.
 *
 * The cost in the common case is a `stat` per log shard rather than a re-read,
 * because `log_files` holds a cursor — milliseconds even when the log holds ten
 * million lines. The expensive case is a first ingest of a large history, which
 * ADR 0024 measured at about seven seconds for 400,000 reviews; that runs in the
 * main process and will stall the window. It is accepted here because the
 * alternative is showing a card that another machine already answered, and
 * because it happens once per collection rather than once per session.
 *
 * `dueCards` and `stats` are always requested together (`App.tsx`'s
 * `Promise.all`), and each opens its own cursor before the other's transaction
 * commits — without sharing, both would read and parse the same unread log
 * bytes, doubling exactly the cost the previous paragraph is about. A caller
 * already mid-ingest is joined rather than duplicated; the entry is cleared
 * once settled, so the next *unrelated* call still checks the cursor for real.
 */
const inFlight = new WeakMap<Core, Promise<void>>();

async function catchUp(core: Core, now: Date): Promise<void> {
  let promise = inFlight.get(core);
  if (!promise) {
    promise = core.ingestLogs(now).then(
      () => {},
      (err: unknown) => {
        if (!isBusy(err)) throw err;
      },
    );
    inFlight.set(core, promise);
    const clear = (): void => {
      if (inFlight.get(core) === promise) inFlight.delete(core);
    };
    // Not `.finally`: it rethrows on rejection, and nothing would be there to
    // catch it on this branch — the caller below is the one awaiting `promise`.
    promise.then(clear, clear);
  }
  return promise;
}

/**
 * Which exercises each screen has been offered today, per open vault (#81).
 *
 * The serving rule's first step keeps one exercise out of a day twice, but it
 * counts only reviews already rated. The Review and Practice tabs each choose
 * before the other has rated anything, so in testing the same exercise came
 * up as a spot review and as a solve within a minute — and the spot's reveal
 * named the solve's skill. Each tab now treats what the *other* was offered
 * today as served. Not its own: a sitting drawn again after a visit elsewhere
 * keeps asking with the exercise it had.
 *
 * Kept in memory and never stored: the choice is computed, as before, and a
 * rebuild reproduces everything that is.
 */
interface Offered {
  day: string;
  review: Set<string>;
  practice: Set<string>;
}
const offered = new WeakMap<Core, Offered>();

function offeredToday(core: Core, dayStart: Date): Offered {
  const day = dayStart.toISOString();
  let o = offered.get(core);
  if (!o || o.day !== day) {
    o = { day, review: new Set(), practice: new Set() };
    offered.set(core, o);
  }
  return o;
}

/**
 * The queue for a session, after catching up on anything already answered:
 * cards, and skills due for a spot review (ADR 0038). The start of the day is
 * this machine's, which is why it is worked out here and handed to `core`.
 */
export async function dueCards(core: Core, now: Date, limit: number): Promise<ReviewItem[]> {
  await catchUp(core, now);
  const dayStart = startOfDay(now);
  const o = offeredToday(core, dayStart);
  const items = core.getReviewItems(now, dayStart, limit, o.practice);
  for (const item of items) if (isSpot(item)) o.review.add(item.filePath);
  return items;
}

/** The one solve the Practice screen offers, after the same catch-up (ADR 0038). */
export async function solveReview(core: Core, now: Date): Promise<SolveReview | null> {
  await catchUp(core, now);
  const dayStart = startOfDay(now);
  const o = offeredToday(core, dayStart);
  const review = core.getSolveReview(now, dayStart, o.review);
  if (review) o.practice.add(review.filePath);
  return review;
}

/** The collection's counts, after the same catch-up. */
export async function counts(core: Core, now: Date, limit: number): Promise<Counts> {
  await catchUp(core, now);
  return core.stats(now, limit);
}
