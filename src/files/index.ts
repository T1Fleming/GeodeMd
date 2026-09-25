/**
 * Spec section 6: the ONLY module that touches the filesystem.
 *
 * That includes the review log — appending a line and reading the `.sr/log/`
 * directory both live here, not in `store/`. Filing the log under `store/` is
 * tempting because it holds review history, but it would put `fsync` and
 * `O_APPEND` in the module whose only job is SQLite.
 */

import { randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, openSync, writeSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** One enumerated candidate. Section 8 step 1 produces these. */
/**
 * Filenames a file syncer writes when it cannot merge two versions of a note.
 *
 * Why this is needed at all: a conflict copy is a **byte copy**, so every card
 * in it already carries a stamp. Section 4's copy-versus-move check finds
 * those ids still present in the original, correctly classifies each as a
 * copy, and mints a fresh id — *into the conflict file*. The result is a
 * duplicate of every card in that note, with its own empty history, sitting in
 * the queue. Nothing is lost, but the user reviews everything twice until they
 * notice ([ADR 0019](../../docs/decisions/0019-report-sync-conflict-copies.md)).
 *
 * The dedupe key does not help here. `(card_id, rated_at)` protects the *log*;
 * notes have no such key, and a duplicated note is indistinguishable from one
 * someone genuinely wrote by copying — a case the design deliberately
 * supports.
 *
 * Only distinctive patterns are listed. Deliberately **not** matched:
 *
 * - iCloud's `note 2.md` and Google Drive's `note (1).md` — those are ordinary
 *   filenames that thousands of people use on purpose
 * - OneDrive's `note-DESKTOP-AB1CDE.md` — a hostname suffix, and a hostname
 *   can be anything
 *
 * A pattern broad enough to catch those is broad enough to silently ignore a
 * note somebody meant to keep, which is a worse failure than the one being
 * fixed. Everything matched here is reported in the summary rather than
 * skipped silently, so a false positive is visible in the one place the user
 * is already looking.
 */
const SYNC_CONFLICT = [
  /** Syncthing: `note.sync-conflict-20260101-120000-ABCDEFG.md` */
  /\.sync-conflict-\d{8}-\d{6}-[a-z0-9]+\./i,
  /** Dropbox and Nextcloud: `note (conflicted copy 2026-01-01).md`, with or
   *  without an owner's name in front of "conflicted". */
  /\([^)]*conflicted copy[^)]*\)/i,
];

/**
 * Does this look like a syncer's conflict copy?
 *
 * Pure, and takes the whole relative path because that is what enumeration
 * carries — only the basename is examined, so a *directory* that matches is
 * not enough to condemn the notes inside it.
 */
export function isSyncConflict(relPath: string): boolean {
  const name = relPath.split("/").pop() ?? relPath;
  return SYNC_CONFLICT.some((re) => re.test(name));
}

export interface Candidate {
  /** Relative to the notes root, with forward slashes. */
  relPath: string;
  mtimeMs: number;
  size: number;
}

export interface EnumerateResult {
  candidates: Candidate[];
  /** Directory symlinks encountered and deliberately not followed. */
  symlinkedDirs: number;
}

/**
 * At most `limit` tasks in flight. Rejects with the failure whose index is
 * lowest, so the error surfaced is the one walk order would have produced.
 *
 * Every rejection is caught INSIDE the worker on purpose. The obvious version —
 * `Promise.all` over a mapped array of promises — leaves one worker's rejection
 * unhandled while its siblings are still running, which terminates the process
 * rather than failing the sync.
 */
async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T, i: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed = false;
  let failure: unknown;
  let failedAt = Number.POSITIVE_INFINITY;

  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        await task(items[i]!, i);
      } catch (err) {
        if (i < failedAt) {
          failure = err;
          failedAt = i;
        }
        failed = true;
      }
    }
  };

  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  if (failed) throw failure;
}

/**
 * How many stats are in flight at once.
 *
 * The reason to bound is not file descriptors — `fs.stat` takes a path and
 * holds none. It is that an unbounded fan-out allocates a promise and a closure
 * per file and hands libuv a queue that deep with no backpressure, which at the
 * top of the scale range is a memory cliff. libuv's threadpool defaults to four
 * threads, so the marginal gain above ~16 is small on a warm local disk; 64 is
 * for the case that actually hurts, a notes folder on a network or cloud-synced
 * filesystem, where the win is overlapping latency rather than CPU.
 */
const STAT_CONCURRENCY = 64;

/**
 * Section 8 step 1. Walk the tree, sorting directory entries so the order is
 * deterministic across machines and filesystems.
 *
 * This is a SEAM: it is the only part of the design that knows how changes are
 * discovered. Everything downstream consumes the list. Swapping this for
 * `@parcel/watcher`'s getEventsSince is a module change, not a restructure.
 *
 * Two passes, and the split is what makes it fast. The walk collects paths
 * without stat'ing; a bounded pool then fills each candidate's mtime and size
 * IN PLACE, at its own index. Ordering is therefore not preserved so much as
 * produced by the same code as before — the pool never pushes, sorts or
 * appends, which matters because section 8 step 4 re-mints the LATER duplicate
 * of an id and writes that stamp into the user's note.
 *
 * Stat'ing per directory instead would be the obvious shape and the wrong one:
 * concurrency would scale with directory width, and a notes folder of topic folders
 * holding a handful of notes each would get almost none of it. Measured on a
 * 20k tree at 4 files per directory, this is 1.6x; at 100 per directory, 2.0x.
 *
 * `statSync` measures faster still — about 1.6x faster than this pool — and is
 * rejected anyway: it blocks the event loop for the length of the walk, and
 * ADR 0013 makes the Electron app a peer interface over this same `core`, where
 * that is a frozen UI rather than an invisible pause in a process about to
 * exit. The measurement favouring it is also warm; on the cold or network-
 * backed tree where sync actually hurts, overlapping the latency wins.
 */
export async function enumerate(root: string): Promise<EnumerateResult> {
  const candidates: Candidate[] = [];
  /** Parallel to `candidates`; absolute paths for the fill pass below. */
  const absPaths: string[] = [];
  let symlinkedDirs = 0;

  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;

      if (entry.isSymbolicLink()) {
        // Section 8 step 1: do not follow, and count. A followed symlink
        // presents one file at two paths; the second visit re-mints every id in
        // it and writes back through the link, so the card's identity churns on
        // every sync and strands its history in the log each time.
        let targetIsDir = false;
        try {
          targetIsDir = (await fs.stat(abs)).isDirectory();
        } catch {
          targetIsDir = false;
        }
        if (targetIsDir) symlinkedDirs++;
        continue;
      }

      if (entry.isDirectory()) {
        // Any dotted directory — covers `.git/`, `.sr/`, and whatever an editor
        // leaves behind, without naming any of them.
        if (entry.name.startsWith(".")) continue;
        await walk(abs, childRel);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md")) continue;

      // Placeholders. They live only until the fill pass and never escape.
      candidates.push({ relPath: childRel, mtimeMs: 0, size: 0 });
      absPaths.push(abs);
    }
  }

  await walk(root, "");

  // Left uncaught, as the inline stat was: a candidate that cannot be stat'd
  // must fail the sync loudly. Dropping it would leave step 6 counting it as
  // vanished and pruning cards for a file that is still there.
  await forEachLimited(absPaths, STAT_CONCURRENCY, async (abs, i) => {
    const st = await fs.stat(abs);
    candidates[i]!.mtimeMs = st.mtimeMs;
    candidates[i]!.size = st.size;
  });

  return { candidates, symlinkedDirs };
}

export interface StatInfo {
  mtimeMs: number;
  size: number;
}

/** stat one file, or null when it is gone. */
export async function statFile(root: string, relPath: string): Promise<StatInfo | null> {
  try {
    const st = await fs.stat(path.join(root, relPath));
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

export async function readFile(root: string, relPath: string): Promise<string> {
  return fs.readFile(path.join(root, relPath), "utf8");
}

/**
 * Section 8 step 4's guarded write.
 *
 * Rewrites `relPath` with `content`, but only if `(mtime, size)` still match
 * `expected`. Returns the post-write stat so the caller can record it — section
 * 8 step 4 is explicit that recording the *pre*-write values would make the
 * file look changed on the next sync, forever.
 *
 * Returns null when the guard fired and nothing was written.
 */
export async function writeIfUnchanged(
  root: string,
  relPath: string,
  content: string,
  expected: StatInfo,
): Promise<StatInfo | null> {
  const abs = path.join(root, relPath);

  // Immediately before writing, stat again. The deferral window in step 4 does
  // not cover a file edited in the milliseconds *after* it was read, and the
  // failure mode is silently reverting the user's keystrokes. Size is compared
  // as well as mtime because mtime granularity is one second on some
  // filesystems, so two edits inside one tick are indistinguishable by mtime.
  const before = await statFile(root, relPath);
  if (!before) return null;
  if (before.mtimeMs !== expected.mtimeMs || before.size !== expected.size) return null;

  await fs.writeFile(abs, content, "utf8");

  const after = await fs.stat(abs);
  return { mtimeMs: after.mtimeMs, size: after.size };
}

// ---------------------------------------------------------------------------
// The review log (section 5a)
// ---------------------------------------------------------------------------

export const LOG_DIR = path.join(".sr", "log");

/** One line of the log. `elapsed`/`scheduled` are omitted on a first review. */
export interface LogLine {
  card: string;
  at: string;
  rating: 1 | 2 | 3 | 4;
  elapsed?: number;
  scheduled?: number;
}

/**
 * `<device>-YYYY-MM.jsonl`. The month comes from the `at` being written, so a
 * review at 23:59:59.998 and one at 00:00:00.002 land in different files and
 * nothing has to be moved (section 5a).
 */
export function shardName(device: string, at: string): string {
  return `${device}-${at.slice(0, 7)}.jsonl`;
}

/**
 * ISO-8601 UTC with exactly three fractional digits and a trailing `Z`.
 *
 * Section 5a pins this: the merged log is ordered by `at`, fixed-width UTC
 * ISO-8601 sorts lexicographically, and mixing precisions silently breaks it
 * because `Z` (0x5A) sorts after `.` (0x2E).
 */
export function formatAt(d: Date): string {
  return d.toISOString();
}

/**
 * Append one review to the current shard and `fsync` it.
 *
 * Section 5a: `O_APPEND`, one `write()` per review, `fsync` before SQLite is
 * touched. fsync rather than a flushed userspace buffer — the difference is
 * surviving a power loss rather than only a killed process, and this loop is
 * paced by a human pressing keys, so the cost is irrelevant. One-line writes
 * far under PIPE_BUF are also why two concurrent processes interleave whole
 * lines and why no lock file is needed.
 */
export async function appendLog(root: string, device: string, line: LogLine): Promise<void> {
  const dir = path.join(root, LOG_DIR);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, shardName(device, line.at));

  const payload = `${JSON.stringify(line)}\n`;
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND, 0o644);
  try {
    writeSync(fd, payload);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export interface ShardInfo {
  name: string;
  size: number;
}

/** Every `.jsonl` in the log directory, whatever it is named (section 5a). */
export async function listShards(root: string): Promise<ShardInfo[]> {
  const dir = path.join(root, LOG_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    // An absent log directory is a first run, not an error.
    return [];
  }
  const shards: ShardInfo[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith(".jsonl")) continue;
    try {
      const st = await fs.stat(path.join(dir, name));
      if (st.isFile()) shards.push({ name, size: st.size });
    } catch {
      // Raced with a delete; the next ingest will see it or not.
    }
  }
  return shards;
}

/**
 * Read a shard from `offset` to EOF.
 *
 * Returns the bytes consumed up to and including the last COMPLETE line, never
 * to EOF. Section 8 step 7: a truncated final line from a crash mid-append will
 * be completed by the next append, and an offset past it would skip the
 * completed line forever — which is precisely the crash the log-write-first
 * ordering exists to survive.
 */
export async function readShardFrom(
  root: string,
  name: string,
  offset: number,
): Promise<{ text: string; consumed: number }> {
  const file = path.join(root, LOG_DIR, name);
  const handle = await fs.open(file, "r");
  try {
    const st = await handle.stat();
    if (offset >= st.size) return { text: "", consumed: offset };
    const length = st.size - offset;
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, offset);

    const lastNewline = buf.lastIndexOf(0x0a);
    if (lastNewline === -1) return { text: "", consumed: offset };
    const complete = buf.subarray(0, lastNewline + 1);
    return { text: complete.toString("utf8"), consumed: offset + complete.length };
  } finally {
    await handle.close();
  }
}

// ---------------------------------------------------------------------------
// Annotations (ADR 0029)
// ---------------------------------------------------------------------------

/**
 * One Markdown file per card, named by its stamp: `.sr/annotations/<id>.md`.
 *
 * Inside `.sr/`, so `enumerate` never walks it — a dotted directory is skipped
 * without being named — and a line in an annotation that happens to contain
 * ` :: ` can never be read as a card or stamped. That skip is what lets this
 * live in the notes folder at all, where it syncs with the notes.
 */
export const ANNOTATION_DIR = path.join(".sr", "annotations");

/**
 * The stamp's shape, and nothing else (ADR 0003). An id is checked against it
 * before it becomes part of a path, so no string arriving over IPC can turn
 * into `../` and write somewhere outside the annotations folder.
 */
const CARD_ID = /^sr-[A-Za-z0-9]{12}$/;

export class NotACardId extends Error {}

function annotationPath(root: string, id: string): string {
  if (!CARD_ID.test(id)) throw new NotACardId(`not a card id: ${JSON.stringify(id)}`);
  return path.join(root, ANNOTATION_DIR, `${id}.md`);
}

/** A card's annotation, exactly as written, or null when it has none. */
export async function readAnnotation(root: string, id: string): Promise<string | null> {
  const file = annotationPath(root, id);
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Whether a card has an annotation, without reading it. */
export async function hasAnnotation(root: string, id: string): Promise<boolean> {
  const file = annotationPath(root, id);
  try {
    return (await fs.stat(file)).isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Write a card's annotation, or remove it when `text` is blank.
 *
 * **Temp file, fsync, rename.** A rename within one directory replaces the
 * old file in a single step, so a crash leaves either the previous annotation
 * or the new one — never half of either. The temp file is fsynced first
 * because a rename can otherwise reach the disk before the data it names. The
 * temp name starts with a dot and does not end in `.md`, so even a stray one
 * left by a power cut is not mistaken for an annotation.
 *
 * Blank means whitespace only. Such a file says nothing, and leaving a
 * zero-byte file behind would make the card look annotated.
 *
 * The text is stored as given — no trimming, no newline added — so a CRLF
 * annotation stays CRLF and one without a final newline keeps that too.
 */
export async function writeAnnotation(root: string, id: string, text: string): Promise<void> {
  const file = annotationPath(root, id);

  if (text.trim() === "") {
    await fs.rm(file, { force: true });
    return;
  }

  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${id}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    const handle = await fs.open(tmp, "w", 0o644);
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
