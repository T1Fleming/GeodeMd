/**
 * Spec section 2a. Config is read in exactly ONE place — here.
 *
 * `host` is the code that knows about THIS MACHINE: XDG paths, `process.env`,
 * `os.hostname()`, how you obtain a `Core` here. `core` knows only about its
 * arguments and is forbidden from reading any of that (section 6 rule 3).
 * That line is the whole point of the module, and it is what lets the CLI and
 * the Electron app share one implementation instead of each growing its own —
 * the open question ADR 0013 named and deliberately left unanswered.
 *
 * `env` and `hostname` stay injectable parameters rather than being read
 * directly. That is what makes this testable, and what lets it sit below an
 * interface at all.
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

/**
 * Where the config lives ([ADR 0026](../../docs/decisions/0026-config-in-application-support-on-macos.md)).
 *
 * `~/Library/Application Support/GeodeMD` on macOS, where a Mac app's settings
 * are looked for; `~/.config/geodemd` elsewhere. An explicit `XDG_CONFIG_HOME`
 * wins on every platform, macOS included — it is how the self-test, the
 * release smoke test and every demo keep off the config pointing at real
 * notes, and losing it would make those runs quietly repoint a live
 * collection.
 *
 * `platform` and `home` are parameters for the same reason `env` is: so both
 * branches are testable on whichever machine runs the suite.
 */
export function configPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  const xdg = env["XDG_CONFIG_HOME"];
  if (xdg) return path.join(xdg, "geodemd", "config.json");
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "GeodeMD", "config.json");
  }
  return path.join(home, ".config", "geodemd", "config.json");
}

/**
 * Where a Mac kept its config before ADR 0026, or null where nothing moved.
 * Only the default location moved: an explicit `XDG_CONFIG_HOME` still means
 * exactly what it did.
 */
export function legacyConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string | null {
  if (env["XDG_CONFIG_HOME"] || platform !== "darwin") return null;
  return path.join(home, ".config", "geodemd", "config.json");
}

/** Unique per call, not merely per process — see `writeConfig`. */
let tmpSeq = 0;

/**
 * The config file to use this session, moving an old Mac one into place first.
 *
 * Without the move, every existing Mac install would open to first-run setup
 * after the update — and setup mints a new `device`, splitting this machine's
 * review history across two log shards. Moving the file keeps `device` by
 * keeping the file.
 *
 * The one rule: **never answer with an empty path while a config exists.** So
 * a config already at the new path wins and the old one is left untouched;
 * the copy goes through a temp file and a rename, so the new path never holds
 * half a config; the old file is removed only once the new one is in place;
 * and if any of it fails, the answer is the OLD path — still readable, and the
 * move is tried again next launch. Copy rather than `rename` from the old path
 * because `~/.config` and `~/Library` can sit on different volumes.
 */
export async function settleConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): Promise<string> {
  const to = configPath(env, platform, home);
  const from = legacyConfigPath(env, platform, home);
  if (from === null || !(await exists(from)) || (await exists(to))) return to;

  const tmp = `${to}.${process.pid}-${tmpSeq++}.tmp`;
  try {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, tmp);
    await fs.rename(tmp, to);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    return from;
  }
  // Moved. Tidying up after is best-effort: a leftover old file is ignored
  // from now on, because the new path exists.
  await fs.rm(from).catch(() => undefined);
  await fs.rmdir(path.dirname(from)).catch(() => undefined);
  return to;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
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
