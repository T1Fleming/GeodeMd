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

import type { Core, Counts, DueCard } from "../../core/index.js";
import { isBusy } from "../../host/errors.js";

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
 */
async function catchUp(core: Core, now: Date): Promise<void> {
  try {
    await core.ingestLogs(now);
  } catch (err) {
    if (!isBusy(err)) throw err;
  }
}

/** The queue for a session, after catching up on anything already answered. */
export async function dueCards(core: Core, now: Date, limit: number): Promise<DueCard[]> {
  await catchUp(core, now);
  return core.getDueCards(now, limit);
}

/** The collection's counts, after the same catch-up. */
export async function counts(core: Core, now: Date, limit: number): Promise<Counts> {
  await catchUp(core, now);
  return core.stats(now, limit);
}
