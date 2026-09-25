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
import { findOverlap, overlapMessage } from "./vaults.js";
import type { RealPath } from "./vaults.js";

/**
 * One vault: a notes folder together with its own database
 * ([ADR 0027](../../docs/decisions/0027-vaults.md)).
 *
 * `id` never changes and is what everything else refers to; `name` is only
 * what the switcher shows, and can be changed at will.
 */
export interface Vault {
  id: string;
  name: string;
  notesPath: string;
  dbPath: string;
}

/**
 * The config file as written: the vaults, which one is active, and the keys
 * that belong to the machine rather than to any one vault.
 *
 * `device` is machine-wide on purpose. It names this machine's log shard, and
 * every vault's `.sr/log/` gets a file under the same name; minting one per
 * vault would say nothing new. `editor` is about which apps are installed
 * here, not about the notes.
 */
export interface Settings {
  device: string;
  /**
   * What `o` opens a card's note in, during review. Optional on purpose:
   * absent means "fall through to $VISUAL, $EDITOR, then the OS default",
   * which is a better answer than any value setup could invent.
   */
  editor?: string;
  /**
   * Whether `o` shows the note inside the app rather than opening `editor`
   * (#51). Its own key rather than a value of `editor`, so choosing the
   * viewer does not cost the editor it hands on to. Written only when true;
   * absent means the editor, which is what `o` did before the viewer.
   */
  viewNotesInside?: boolean;
  /** The id of the vault the app has open. Always one of `vaults`. */
  active: string;
  /** Never empty: a config with no vault in it is no config at all. */
  vaults: Vault[];
}

/**
 * What a `Core` is opened from: the active vault, with the machine-wide keys
 * beside it. Everything below the config reads this, and none of it needs to
 * know that other vaults exist.
 */
export interface VaultConfig extends Vault {
  device: string;
  editor?: string;
  viewNotesInside?: boolean;
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

function dataDir(env: NodeJS.ProcessEnv): string {
  const base = env["XDG_DATA_HOME"] ?? path.join(os.homedir(), ".local", "share");
  return path.join(base, "geodemd");
}

/**
 * Where the first vault's database goes, and where every database went before
 * there were vaults. A migrated config keeps whatever path it had.
 */
export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(dataDir(env), "db.sqlite");
}

/**
 * Where a vault added later keeps its database: a directory of its own, named
 * by the vault's id, so no two vaults can land on one file — whatever their
 * names, and however often they are renamed.
 */
export function vaultDbPath(id: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(dataDir(env), "vaults", id, "db.sqlite");
}

const nanoid8 = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);
const VAULT_ID = /^[a-z0-9]{8}$/;

/** A vault's id. Random rather than derived, so a re-pointed vault keeps it. */
export const newVaultId = (): string => nanoid8();

/** What a vault is called when nobody has named it: its folder's name. */
export function defaultVaultName(notesPath: string): string {
  return path.basename(path.resolve(notesPath)) || notesPath;
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


/**
 * The file as written, with defaults filled, and whether anything had to be
 * filled or converted — which is what decides whether `ensureSettings` writes.
 * Null when absent or unusable.
 *
 * Two shapes are read. The current one holds a list of vaults. The one before
 * it held a single `notesPath` and `dbPath` at the top level, and becomes a
 * list of one: same folder, same database, same `device`, same `editor`.
 */
async function readRaw(
  file: string,
  env: NodeJS.ProcessEnv,
): Promise<{ settings: Settings; changed: boolean; minted: boolean } | null> {
  let parsed: Record<string, unknown>;
  try {
    const raw = await fs.readFile(file, "utf8");
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return null;
    parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

  let changed = false;
  let vaults: Vault[];
  let active = str(parsed["active"]);

  if (Array.isArray(parsed["vaults"])) {
    vaults = [];
    for (const entry of parsed["vaults"] as unknown[]) {
      if (typeof entry !== "object" || entry === null) continue;
      const v = entry as Record<string, unknown>;
      const notesPath = str(v["notesPath"]);
      if (notesPath === undefined) continue;
      let id = str(v["id"]);
      if (id === undefined || vaults.some((o) => o.id === id)) {
        id = newVaultId();
        changed = true;
      }
      const name = str(v["name"])?.trim() || defaultVaultName(notesPath);
      const dbPath = str(v["dbPath"]) ?? vaultDbPath(id, env);
      if (name !== v["name"] || dbPath !== v["dbPath"]) changed = true;
      vaults.push({ id, name, notesPath, dbPath });
    }
    if (vaults.length === 0) return null;
  } else {
    // The single-folder shape. Kept readable because every install before
    // vaults has one, and failing to read it would open first-run setup —
    // which mints a new `device` and splits this machine's history in two.
    const notesPath = str(parsed["notesPath"]);
    if (notesPath === undefined) return null;
    const id = newVaultId();
    vaults = [
      {
        id,
        name: defaultVaultName(notesPath),
        notesPath,
        dbPath: str(parsed["dbPath"]) ?? defaultDbPath(env),
      },
    ];
    active = id;
    changed = true;
  }

  if (!vaults.some((v) => v.id === active)) {
    active = vaults[0]!.id;
    changed = true;
  }

  let device = str(parsed["device"]);
  const minted = device === undefined;
  if (device === undefined) {
    device = defaultDevice();
    changed = true;
  }

  const settings: Settings = { device, active: active!, vaults };
  const editor = str(parsed["editor"]);
  if (editor !== undefined && editor.trim() !== "") settings.editor = editor;
  // Only a literal `true` turns it on: a hand-edited `"yes"` is not a
  // reason to stop opening the editor the user chose.
  if (parsed["viewNotesInside"] === true) settings.viewNotesInside = true;
  return { settings, changed, minted };
}

/**
 * The active vault, with the machine-wide keys beside it.
 *
 * Named fields rather than a spread, so `active` and the other vaults stay
 * out of what a `Core` is opened from.
 */
export function activeVault(settings: Settings): VaultConfig {
  const v = settings.vaults.find((x) => x.id === settings.active) ?? settings.vaults[0]!;
  const config: VaultConfig = {
    id: v.id,
    name: v.name,
    notesPath: v.notesPath,
    dbPath: v.dbPath,
    device: settings.device,
  };
  if (settings.editor !== undefined) config.editor = settings.editor;
  if (settings.viewNotesInside) config.viewNotesInside = true;
  return config;
}

/**
 * A pure read. Defaults are filled but NOT persisted, so a file with no
 * `device` yields a different name on every call, and a single-folder config
 * a different vault id. Callers about to write a review log want
 * `ensureSettings` instead.
 */
export async function readSettings(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Settings | null> {
  return (await readRaw(file, env))?.settings ?? null;
}

/** The active vault, read purely — see `readSettings`. */
export async function readConfig(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VaultConfig | null> {
  const s = await readSettings(file, env);
  return s ? activeVault(s) : null;
}

/**
 * Read, and persist anything that had to be defaulted or converted.
 *
 * `device` is why this first existed. It defaults to a slug plus a RANDOM
 * suffix, so a config without one hands out a different name on every read —
 * and section 5a's log layout rests on one writer per file.
 *
 * The migration from a single-folder config goes through here too, and has
 * the same rule: **it never mints a new `device`.** The old file's `device`,
 * `dbPath` and `editor` become the machine's and the first vault's. The write
 * is `writeConfig`'s temp file and rename, so the file on disk is either the
 * old config or the new one, never half of each. If the write fails, the old
 * file is left exactly as it was and this answers with the migrated config in
 * memory, so the app still opens — and the migration is tried again next time.
 * The exception is a config that also had no `device`: answering with a name
 * that was never written would hand out a new one on every read, which is the
 * bug this function exists to prevent, so that failure is thrown.
 *
 * Two writers healing at the same instant each mint a name and race. The write
 * is atomic and the result is re-read, so the FILE always ends up with exactly
 * one device and every later read agrees. The one thing not guaranteed is that
 * a loser notices within its own session: it may use the name it minted until
 * it next reads the file.
 *
 * That residue is deliberate. Closing it needs an election — a lock file — and
 * the cost is wrong for the exposure: it requires two processes to heal the
 * same device-less config within milliseconds of each other, exactly once in
 * that config's life, and the consequence is one session's reviews landing in a
 * shard named by the losing device. Ingest reads every `.jsonl`, so nothing is
 * lost and the next run converges.
 */
export async function ensureSettings(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Settings | null> {
  const raw = await readRaw(file, env);
  if (!raw) return null;
  if (!raw.changed) return raw.settings;

  try {
    await writeConfig(file, raw.settings);
  } catch (err) {
    if (raw.minted) throw err;
    return raw.settings;
  }
  return (await readRaw(file, env))?.settings ?? raw.settings;
}

/** The active vault, persisted — see `ensureSettings`. */
export async function ensureConfig(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VaultConfig | null> {
  const s = await ensureSettings(file, env);
  return s ? activeVault(s) : null;
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
export async function writeConfig(file: string, settings: Settings): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}-${tmpSeq++}.tmp`;
  const ordered: Settings = { device: settings.device, active: settings.active, vaults: settings.vaults };
  if (settings.editor !== undefined) ordered.editor = settings.editor;
  if (settings.viewNotesInside) ordered.viewNotesInside = true;
  await fs.writeFile(tmp, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

/** No config to change. The interface turns this into first-run setup. */
export class NoConfig extends Error {
  constructor() {
    super("no config yet");
  }
}

/**
 * Read, change, write — every edit to the vault list goes through here, so
 * each one starts from a config whose `device` is already persisted and ends
 * with `writeConfig`'s atomic rename.
 */
async function update<T>(
  file: string,
  env: NodeJS.ProcessEnv,
  change: (s: Settings) => Promise<T> | T,
): Promise<{ settings: Settings; value: T }> {
  const current = await ensureSettings(file, env);
  if (!current) throw new NoConfig();
  const next: Settings = { ...current, vaults: current.vaults.map((v) => ({ ...v })) };
  const value = await change(next);
  await writeConfig(file, next);
  return { settings: next, value };
}

function find(s: Settings, id: string): Vault {
  const v = s.vaults.find((x) => x.id === id);
  if (!v) throw new VaultRefused(`there is no vault with id ${id}`);
  return v;
}

/**
 * A change to the vault list that would break one of its rules — an overlap,
 * removing the vault in use, a blank name. Its own class so it is classified
 * as a refusal the user can act on, not as a bug.
 */
export class VaultRefused extends Error {}

const realpath: RealPath = (p) => fs.realpath(p);

async function refuseOverlap(s: Settings, notesPath: string, except: string | null): Promise<void> {
  const o = await findOverlap(notesPath, s.vaults, realpath, except);
  if (o) throw new VaultRefused(overlapMessage(notesPath, o));
}

/** A name nobody else in the list has, so the switcher never shows two alike. */
function unusedName(s: Settings, wanted: string, except: string | null = null): string {
  const taken = new Set(s.vaults.filter((v) => v.id !== except).map((v) => v.name));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) if (!taken.has(`${wanted} ${n}`)) return `${wanted} ${n}`;
}

/**
 * Set or clear `editor`, keeping every other key as it was.
 *
 * `null` — or a blank value — removes the key, which means "the system
 * default". Null when there is no config to set it in: the editor is chosen
 * after setup, never instead of it.
 */
export async function setEditor(
  file: string,
  editor: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Settings | null> {
  try {
    const { settings } = await update(file, env, (s) => {
      delete s.editor;
      const value = editor?.trim() ?? "";
      if (value !== "") s.editor = value;
    });
    return settings;
  } catch (err) {
    if (err instanceof NoConfig) return null;
    throw err;
  }
}

/**
 * Turn the note viewer on or off (#51), keeping every other key — `editor`
 * above all, which the viewer's `e` still opens. Off removes the key rather
 * than writing `false`. Null when there is no config, as for `setEditor`.
 */
export async function setViewNotesInside(
  file: string,
  on: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Settings | null> {
  try {
    const { settings } = await update(file, env, (s) => {
      delete s.viewNotesInside;
      if (on) s.viewNotesInside = true;
    });
    return settings;
  } catch (err) {
    if (err instanceof NoConfig) return null;
    throw err;
  }
}

/**
 * Add a vault and make it the active one.
 *
 * Adding is how a vault's first sync happens, and the interface walks it
 * through the same preview as a first run, because that sync stamps every
 * card line in the folder. `id` is the one the proposal showed, so the
 * database path the user was shown is the one written; an id that is
 * malformed or taken is replaced rather than trusted.
 *
 * Refused when the folder overlaps a vault already in the list — see
 * `host/vaults.ts` for why that splits history silently.
 */
export async function addVault(
  file: string,
  notesPath: string,
  opts: { id?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<VaultConfig> {
  const env = opts.env ?? process.env;
  const { settings } = await update(file, env, async (s) => {
    const resolved = path.resolve(notesPath);
    await refuseOverlap(s, resolved, null);
    const id =
      opts.id !== undefined && VAULT_ID.test(opts.id) && !s.vaults.some((v) => v.id === opts.id)
        ? opts.id
        : newVaultId();
    s.vaults.push({
      id,
      name: unusedName(s, defaultVaultName(resolved)),
      notesPath: resolved,
      dbPath: vaultDbPath(id, env),
    });
    s.active = id;
  });
  return activeVault(settings);
}

/** Make another vault the active one. Nothing else about any vault changes. */
export async function chooseVault(
  file: string,
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VaultConfig> {
  const { settings } = await update(file, env, (s) => {
    find(s, id);
    s.active = id;
  });
  return activeVault(settings);
}

/** Rename a vault. Only what the switcher shows changes; its `id` and paths stay. */
export async function renameVault(
  file: string,
  id: string,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Settings> {
  const { settings } = await update(file, env, (s) => {
    const v = find(s, id);
    const wanted = name.trim();
    if (wanted === "") throw new VaultRefused("a vault needs a name");
    if (s.vaults.some((o) => o.id !== id && o.name === wanted)) {
      throw new VaultRefused(`there is already a vault called “${wanted}”`);
    }
    v.name = wanted;
  });
  return settings;
}

/**
 * Take a vault out of the list, and hand back what it was.
 *
 * **Its notes and its log are never touched** — they are the user's, and they
 * are the only durable part of a vault. The database is a cache; whether to
 * delete it is the caller's choice, through `removeDatabase`.
 *
 * The active vault cannot be removed. Something has to be open afterwards, and
 * choosing which is the user's decision, not this function's — switch first.
 */
export async function removeVault(
  file: string,
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ removed: Vault; settings: Settings }> {
  const { settings, value } = await update(file, env, (s) => {
    const v = find(s, id);
    if (s.active === id) {
      throw new VaultRefused("switch to another vault before removing this one");
    }
    s.vaults = s.vaults.filter((x) => x.id !== id);
    return v;
  });
  return { removed: value, settings };
}

/**
 * Delete a vault's database — the file and the siblings SQLite keeps beside
 * it — and the directory `vaultDbPath` made for it, if that is where it was.
 *
 * Only ever the cache. A rebuild recreates everything in it from the notes and
 * the log, so this loses nothing but the time a first sync takes.
 */
export async function removeDatabase(vault: Vault): Promise<void> {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    await fs.rm(`${vault.dbPath}${suffix}`, { force: true });
  }
  const dir = path.dirname(vault.dbPath);
  if (path.basename(dir) === vault.id) await fs.rmdir(dir).catch(() => undefined);
}

export class InitRefused extends Error {}

/**
 * Write the config for a first run, or re-point the active vault.
 *
 * With no config, this creates one holding a single vault. With one, it
 * refuses unless `force` — and forced, it points the ACTIVE vault at the new
 * folder: same `id`, same database, and a name that follows the folder only if
 * it was still the folder's name. That is the repair case, and **Change
 * folder…**; adding a second vault is `addVault`, and the two are different
 * actions on purpose.
 *
 * `device` and `editor` are preserved across a force. Re-running setup to fix
 * a notesPath typo should not double as a way to change the machine's
 * identity — regenerating `device` silently starts a second log file and
 * scatters one machine's history across two names.
 *
 * Refused when the folder overlaps one of the OTHER vaults.
 */
export async function initConfig(
  file: string,
  notesPath: string,
  opts: { force?: boolean; dbPath?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<VaultConfig> {
  const env = opts.env ?? process.env;
  const resolved = path.resolve(notesPath);
  const existing = await readSettings(file, env);
  if (existing && !opts.force) {
    throw new InitRefused(`config already exists at ${file} — pass --force to overwrite`);
  }

  if (!existing) {
    const id = newVaultId();
    const settings: Settings = {
      device: defaultDevice(),
      active: id,
      vaults: [
        {
          id,
          name: defaultVaultName(resolved),
          notesPath: resolved,
          dbPath: opts.dbPath ?? defaultDbPath(env),
        },
      ],
    };
    await writeConfig(file, settings);
    return activeVault(settings);
  }

  const { settings } = await update(file, env, async (s) => {
    const v = find(s, s.active);
    await refuseOverlap(s, resolved, v.id);
    if (v.name === defaultVaultName(v.notesPath)) {
      v.name = unusedName(s, defaultVaultName(resolved), v.id);
    }
    v.notesPath = resolved;
    if (opts.dbPath !== undefined) v.dbPath = opts.dbPath;
  });
  return activeVault(settings);
}
