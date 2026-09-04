/**
 * Spec section 6: the ONLY module that touches the filesystem.
 *
 * That includes the review log — appending a line and reading the `.sr/log/`
 * directory both live here, not in `store/`. Filing the log under `store/` is
 * tempting because it holds review history, but it would put `fsync` and
 * `O_APPEND` in the module whose only job is SQLite.
 */

import { closeSync, constants, fsyncSync, openSync, writeSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** One enumerated candidate. Section 8 step 1 produces these. */
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
 * Section 8 step 1. Walk the tree, sorting directory entries so the order is
 * deterministic across machines and filesystems.
 *
 * This is a SEAM: it is the only part of the design that knows how changes are
 * discovered. Everything downstream consumes the list. Swapping this for
 * `@parcel/watcher`'s getEventsSince is a module change, not a restructure.
 */
export async function enumerate(root: string): Promise<EnumerateResult> {
  const candidates: Candidate[] = [];
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

      const st = await fs.stat(abs);
      candidates.push({ relPath: childRel, mtimeMs: st.mtimeMs, size: st.size });
    }
  }

  await walk(root, "");
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
