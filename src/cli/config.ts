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
  /**
   * What `o` opens a card's note in, during review. Optional on purpose:
   * absent means "fall through to $VISUAL, $EDITOR, then the OS default",
   * which is a better answer than any value `init` could invent.
   */
  editor?: string;
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

/** The file as written, before defaults. Null when absent or unusable. */
async function readRaw(file: string): Promise<Partial<FileConfig> | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<FileConfig>;
    if (typeof parsed.notesPath !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function fill(parsed: Partial<FileConfig> & { notesPath: string }): FileConfig {
  const config: FileConfig = {
    notesPath: parsed.notesPath,
    device: typeof parsed.device === "string" ? parsed.device : defaultDevice(),
    dbPath: typeof parsed.dbPath === "string" ? parsed.dbPath : defaultDbPath(),
  };
  if (typeof parsed.editor === "string" && parsed.editor.trim() !== "") {
    config.editor = parsed.editor;
  }
  return config;
}

/**
 * A pure read. Defaults are filled but NOT persisted, so a file with no
 * `device` yields a different name on every call. Callers about to write a
 * review log want `ensureConfig` instead.
 */
export async function readConfig(file: string): Promise<FileConfig | null> {
  const raw = await readRaw(file);
  return raw ? fill(raw as Partial<FileConfig> & { notesPath: string }) : null;
}

/**
 * Read, and persist anything that had to be defaulted.
 *
 * `device` is why this exists. It defaults to a slug plus a RANDOM suffix, so a
 * config without one hands out a different name on every read — and section
 * 5a's log layout rests on one writer per file. With a single interface that
 * was invisible, because `init` always writes a device. With two it is
 * reachable: the CLI and the app read the same file, mint different names, and
 * append to two shards. Nothing is lost, since ingest reads every `.jsonl`, but
 * the invariant the layout leans on is quietly gone.
 *
 * Two writers healing at the same instant each mint a name and race. The write
 * is atomic and the result is re-read, so the FILE always ends up with exactly
 * one device and every later read agrees. The one thing not guaranteed is that
 * a loser notices within its own session: it may use the name it minted until
 * it next reads the file.
 *
 * That residue is deliberate. Closing it needs an election — a lock file — and
 * the cost is wrong for the exposure: it requires two interfaces to heal the
 * same device-less config within milliseconds of each other, exactly once in
 * that config's life, and the consequence is one session's reviews landing in a
 * shard named by the losing device. Ingest reads every `.jsonl`, so nothing is
 * lost and the next run converges. Weigh that against the bug being fixed here,
 * which was every read minting a new name, forever.
 */
export async function ensureConfig(file: string): Promise<FileConfig | null> {
  const raw = await readRaw(file);
  if (!raw) return null;
  const parsed = raw as Partial<FileConfig> & { notesPath: string };
  if (typeof parsed.device === "string") return fill(parsed);

  const healed = fill(parsed);
  await writeConfig(file, healed);
  const after = await readRaw(file);
  return after ? fill(after as Partial<FileConfig> & { notesPath: string }) : healed;
}

/** Unique per call, not merely per process — see `writeConfig`. */
let tmpSeq = 0;

/**
 * Temp file plus rename, so a config is never observed half-written and two
 * writers healing a missing `device` produce one winner rather than an
 * interleaved file.
 *
 * The temp name needs the counter as well as the pid. Two concurrent calls
 * inside ONE process would otherwise pick the same path, and the second rename
 * fails with ENOENT because the first already moved it away.
 */
export async function writeConfig(file: string, config: FileConfig): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}-${tmpSeq++}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

export class InitRefused extends Error {}

/**
 * Section 2a: `init` refuses to overwrite an existing config unless --force,
 * and preserves `device` even then. It should be re-runnable to fix a
 * notesPath typo without that doubling as a way to change the machine's
 * identity — regenerating `device` silently starts a second log file and
 * scatters one machine's history across two names. `editor` is preserved for
 * the same reason: re-running `init` should not silently discard a setting it
 * never asked about.
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
  if (existing?.editor !== undefined) config.editor = existing.editor;
  await writeConfig(file, config);
  return config;
}
