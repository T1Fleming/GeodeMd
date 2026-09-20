/**
 * The questions a first run has to answer before anything is written.
 *
 * All of it lives here rather than in the app because none of it is drawing —
 * it is *what is true about this folder and this machine*, which is `host`'s
 * whole job. The CLI's `init` answers a thinner version of the same questions
 * and could adopt these; the app needs richer answers because it has to show
 * the user the stakes rather than warn about them in a sentence and exit.
 *
 * The stakes, specifically: **the first real sync writes an id comment into
 * every note that contains a card.** On an existing collection that is a diff
 * across the whole tree. `geode init` can only say so; a window can make the
 * number visible before it happens.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { enumerate } from "../files/index.js";
import { defaultDbPath, defaultDevice, readConfig } from "./config.js";
import type { FileConfig } from "./config.js";

/** What is actually in the folder the user just picked. */
export interface FolderReport {
  path: string;
  /** False when the path is gone — the repair case, not only the first run. */
  exists: boolean;
  /** A file, or something that is not a directory at all. */
  isDirectory: boolean;
  markdownFiles: number;
  /** Whether a `.git` is present, which decides which warning is honest. */
  isGitRepo: boolean;
  /** Directory symlinks a sync would skip. Counted here so it is not a surprise later. */
  symlinkedDirs: number;
}

/**
 * Look, but touch nothing.
 *
 * Counting the `.md` files is the check `geode init` cannot make and the one
 * that catches the likeliest mistake — pointing at a Downloads folder, or at
 * the parent of the notes rather than the notes. It is a **soft** signal: a
 * genuinely empty folder is a perfectly good place to start writing cards, so
 * this reports and never refuses.
 *
 * `enumerate` rather than a fresh walk, so the number shown here is the number
 * the sync will actually use — same dotted-directory skip, same `.md` filter,
 * same refusal to follow directory symlinks. A second implementation would
 * drift and the drift would look like a bug in the count.
 */
export async function inspectFolder(folder: string): Promise<FolderReport> {
  const resolved = path.resolve(folder);
  const empty: FolderReport = {
    path: resolved,
    exists: false,
    isDirectory: false,
    markdownFiles: 0,
    isGitRepo: false,
    symlinkedDirs: 0,
  };

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return empty;
  }
  if (!stat.isDirectory()) return { ...empty, exists: true };

  const { candidates, symlinkedDirs } = await enumerate(resolved);
  return {
    path: resolved,
    exists: true,
    isDirectory: true,
    markdownFiles: candidates.length,
    isGitRepo: await exists(path.join(resolved, ".git")),
    symlinkedDirs,
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * What writing a config for this folder would produce, and what it would
 * replace.
 *
 * `replaces` is the part worth having. `initConfig` already preserves `device`
 * and `editor` across a `--force`, and that is correct — regenerating `device`
 * silently starts a second log shard and scatters one machine's history across
 * two names. But a GUI that quietly preserves a field looks like it ignored
 * you, so the app has to be able to *say* what is kept. It can only say it if
 * it is told, which is what this returns.
 *
 * Nothing is written. The name in `device` is a **proposal**: it is minted
 * fresh on every call, so the value shown to the user is not the value that
 * ends up in the file unless a write follows. That is fine here and would not
 * be if this pretended to be a read of the real config — hence the name.
 */
export interface ConfigProposal {
  notesPath: string;
  device: string;
  dbPath: string;
  /** The config this would overwrite, or null when there is none. */
  replaces: FileConfig | null;
  /** Fields carried over from `replaces` rather than minted. */
  preserved: Array<"device" | "editor">;
}

export async function proposeConfig(
  configFile: string,
  notesPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ConfigProposal> {
  const replaces = await readConfig(configFile);
  const preserved: Array<"device" | "editor"> = [];
  if (replaces) {
    preserved.push("device");
    if (replaces.editor !== undefined) preserved.push("editor");
  }
  return {
    notesPath: path.resolve(notesPath),
    device: replaces?.device ?? defaultDevice(),
    dbPath: replaces?.dbPath ?? defaultDbPath(env),
    replaces,
    preserved,
  };
}
