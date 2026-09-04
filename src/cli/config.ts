/**
 * Spec section 2a. Config is read in exactly ONE place — here, in `cli`.
 * `core` never reads the filesystem for config and never touches process.env
 * (section 6 rule 3).
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { customAlphabet } from "nanoid";

export interface FileConfig {
  notesPath: string;
  device: string;
  dbPath: string;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * `sr-` plus 12 chars. Section 4: twelve rather than eight because at a million
 * cards the birthday bound on 62^8 gives roughly a 1-in-436 chance of a
 * collision, and a collision does not fail loudly — it looks exactly like a
 * copy, so one card is silently re-minted and its history stranded.
 */
const nanoid12 = customAlphabet(ALPHABET, 12);
export const newId = (): string => `sr-${nanoid12()}`;

const nanoid4 = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 4);

/** XDG on every platform, macOS included. One less branch. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config");
  return path.join(base, "geodemd", "config.json");
}

export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env["XDG_DATA_HOME"] ?? path.join(os.homedir(), ".local", "share");
  return path.join(base, "geodemd", "db.sqlite");
}

/**
 * Slugified hostname plus a short random suffix, fixed once at `init`.
 * Two machines both called `macbook-pro` would otherwise share a filename and
 * break the one-writer-per-file invariant the log layout rests on (section 5a).
 */
export function defaultDevice(hostname = os.hostname()): string {
  const slug =
    hostname
      .toLowerCase()
      .replace(/\.local$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "device";
  return `${slug}-${nanoid4()}`;
}

export async function readConfig(file: string): Promise<FileConfig | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<FileConfig>;
    if (typeof parsed.notesPath !== "string") return null;
    return {
      notesPath: parsed.notesPath,
      device: typeof parsed.device === "string" ? parsed.device : defaultDevice(),
      dbPath: typeof parsed.dbPath === "string" ? parsed.dbPath : defaultDbPath(),
    };
  } catch {
    return null;
  }
}

export async function writeConfig(file: string, config: FileConfig): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export class InitRefused extends Error {}

/**
 * Section 2a: `init` refuses to overwrite an existing config unless --force,
 * and preserves `device` even then. It should be re-runnable to fix a
 * notesPath typo without that doubling as a way to change the machine's
 * identity — regenerating `device` silently starts a second log file and
 * scatters one machine's history across two names.
 */
export async function initConfig(
  file: string,
  notesPath: string,
  opts: { force?: boolean; dbPath?: string } = {},
): Promise<FileConfig> {
  const existing = await readConfig(file);
  if (existing && !opts.force) {
    throw new InitRefused(`config already exists at ${file} — pass --force to overwrite`);
  }
  const config: FileConfig = {
    notesPath: path.resolve(notesPath),
    device: existing?.device ?? defaultDevice(),
    dbPath: opts.dbPath ?? existing?.dbPath ?? defaultDbPath(),
  };
  await writeConfig(file, config);
  return config;
}
