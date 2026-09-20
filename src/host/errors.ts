/**
 * Classifying failures once, for both interfaces.
 *
 * This exists because an error's *type* does not survive every boundary it has
 * to cross. Electron's IPC serialization drops both the prototype and custom
 * properties, so `err instanceof ConfigError` and a `.code` check both silently
 * become false on the far side. Classification therefore happens on the near
 * side, while the error is still itself, and what crosses is a plain tag.
 *
 * The CLI uses the same tags for its exit codes, which means it exercises this
 * classifier on every run — one table instead of two `instanceof` chains that
 * drift.
 */

import { ConfigError } from "../core/index.js";
import { InitRefused } from "./config.js";

export type ErrorKind =
  /** No config yet. A first run, not a failure — route to setup, not an alert. */
  | "no-config"
  /** notesPath missing, or not a directory. */
  | "config"
  /** `init` refused to overwrite without --force. */
  | "init-refused"
  /**
   * The editor would not start — not installed, or the `editor` key is wrong.
   *
   * Its own kind rather than `config`, which an interface is entitled to read
   * as "your notesPath is gone, let me help you repoint it". Being unable to
   * open a note is user-fixable but changes nothing about the collection, and
   * routing it to a repair screen would be worse than saying so in a line.
   */
  | "editor"
  /** Anything unexpected. */
  | "internal";

/**
 * Is this the database being briefly unavailable?
 *
 * WAL allows one writer, so a `reviewCard` issued while a long sync or rebuild
 * holds the write lock exhausts the busy timeout and fails. **This is not an
 * error worth surfacing**: the rating was already `fsync`ed to the log before
 * SQLite was touched, so the next ingest repairs the row. With two interfaces
 * sharing one database it stops being rare.
 *
 * Duck-typed on `.code` because better-sqlite3 throws its own error class, and
 * because the property is what survives — the class does not.
 */
export function isBusy(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    String((err as { code: unknown }).code).startsWith("SQLITE_BUSY")
  );
}

/** Tag an error while it still has its prototype. */
export function classify(err: unknown): ErrorKind {
  if (err instanceof ConfigError) return "config";
  if (err instanceof InitRefused) return "init-refused";
  return "internal";
}

/**
 * The CLI's exit-code contract, derived from the same tags rather than
 * restated: `1` for anything the user can fix by configuring, `2` for a bug.
 * A skipped unreadable file is neither — it is reported in the summary and
 * still exits `0`.
 */
export function exitCodeFor(kind: ErrorKind): 1 | 2 {
  return kind === "internal" ? 2 : 1;
}
