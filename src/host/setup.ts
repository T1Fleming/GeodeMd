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
 * across the whole tree. A line of advice can only say so; a window can make the
 * number visible before it happens.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { enumerate } from "../files/index.js";
import {
  defaultDbPath,
  defaultDevice,
  newVaultId,
  readConfig,
  readSettings,
  vaultDbPath,
} from "./config.js";
import type { VaultConfig } from "./config.js";
import { findOverlap, overlapMessage } from "./vaults.js";

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
 * Counting the `.md` files is the check a config writer cannot make and the one
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
 * Two kinds of write. **`point`** is a first run, a repair, or Change
 * folder…: it points the active vault at this folder, keeping that vault's
 * database. **`add`** makes a new vault beside the others, with a database of
 * its own ([ADR 0027](../../docs/decisions/0027-vaults.md)).
 *
 * `replaces` is the part worth having for `point`. `initConfig` preserves
 * `device` and `editor` across a `force`, and that is correct — regenerating
 * `device` silently starts a second log shard and scatters one machine's
 * history across two names. But a GUI that quietly preserves a field looks
 * like it ignored you, so the app has to be able to *say* what is kept. It
 * can only say it if it is told, which is what this returns.
 *
 * Nothing is written. On a first run the name in `device` is a **proposal**:
 * minted fresh on every call, so the value shown is not the value written.
 * `vault` is different — `addVault` takes it back, so the database path shown
 * for a new vault is the path it gets.
 */
export interface ConfigProposal {
  mode: "point" | "add";
  notesPath: string;
  device: string;
  dbPath: string;
  /** The vault's id: the active one's for `point`, a fresh one for `add`. */
  vault: string;
  /** For `point`, the active vault this would re-point, or null on a first run. */
  replaces: VaultConfig | null;
  /** Machine-wide fields carried over rather than minted. */
  preserved: Array<"device" | "editor">;
}

export async function proposeConfig(
  configFile: string,
  notesPath: string,
  mode: "point" | "add" = "point",
  env: NodeJS.ProcessEnv = process.env,
): Promise<ConfigProposal> {
  const current = await readConfig(configFile, env);
  const preserved: Array<"device" | "editor"> = [];
  if (current) {
    preserved.push("device");
    if (current.editor !== undefined) preserved.push("editor");
  }
  if (mode === "add") {
    const id = newVaultId();
    return {
      mode,
      notesPath: path.resolve(notesPath),
      device: current?.device ?? defaultDevice(),
      dbPath: vaultDbPath(id, env),
      vault: id,
      replaces: null,
      preserved,
    };
  }
  return {
    mode,
    notesPath: path.resolve(notesPath),
    device: current?.device ?? defaultDevice(),
    dbPath: current?.dbPath ?? defaultDbPath(env),
    vault: current?.id ?? newVaultId(),
    replaces: current,
    preserved,
  };
}

/**
 * Which vault, if any, this folder would overlap — for showing at the folder
 * step, before anything is written. `addVault` and `initConfig` refuse the
 * same thing again at the write, so this is the early warning rather than
 * the guard.
 *
 * `mode` decides whether the active vault counts. Re-pointing it may move it
 * inside its own old folder; adding a vault there may not.
 */
export async function vaultOverlap(
  configFile: string,
  folder: string,
  mode: "point" | "add",
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const s = await readSettings(configFile, env);
  if (!s) return null;
  const o = await findOverlap(folder, s.vaults, (p) => fs.realpath(p), mode === "point" ? s.active : null);
  return o ? overlapMessage(folder, o) : null;
}
