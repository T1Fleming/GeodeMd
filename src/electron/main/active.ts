/**
 * The vault the app has open, and the rule for changing it.
 *
 * Everything the main process derives from the config lives here — the
 * `Core`, the `Store`, the `Runner` and `OpenedNotes` — so there is one place
 * that opens them and one that drops them. Deliberately free of Electron
 * imports, like `runs.ts`, so switching between two real vaults is tested
 * under plain vitest.
 *
 * One vault is open at a time ([ADR 0027](../../../docs/decisions/0027-vaults.md)).
 * Switching is closing this `Store` and opening the other vault's; its mtime
 * cache is intact, so the next sync of an unchanged vault reads no file.
 */

import type { Core } from "../../core/index.js";
import type { Store } from "../../store/index.js";
import { NoConfig, VaultRefused } from "../../host/config.js";
import type { VaultConfig } from "../../host/config.js";
import { OpenedNotes } from "../../host/editor.js";
import { openCore, readAppConfig } from "../../host/open.js";
import type { RunFinished, RunProgress, RunStatus } from "../ipc.js";
import { Runner } from "./runs.js";

export interface Open {
  config: VaultConfig;
  core: Core;
  store: Store;
  runner: Runner;
  /**
   * Kept beside the Core rather than in the renderer: the renderer cannot
   * stat a file, and it is the mtime at open time — not the path — that makes
   * the end-of-session answer possible.
   */
  opened: OpenedNotes;
}

export interface ActiveDeps {
  configFile: string;
  emit: (p: RunProgress) => void;
  finish: (f: RunFinished) => void;
  /** Injected for tests, as `Runner`'s are; defaults to the real clock. */
  now?: () => Date;
}

/** What leaving a vault hands back: the notes edited since they were opened in it. */
export interface Left {
  vault: string;
  changed: string[];
}

export class Active {
  private open: Open | null = null;
  /**
   * True while `change` is between its check and its reset. A run started in
   * that window — the config write is awaited, and another IPC call can land
   * during it — would be running on the Store about to be closed.
   */
  private changing = false;

  constructor(private readonly deps: ActiveDeps) {}

  /** The open vault, if one has been opened. Never opens one. */
  get current(): Open | null {
    return this.open;
  }

  /**
   * The open vault, opened on first use — never at startup. On a first run
   * there is no config and therefore no dbPath, and opening a database at a
   * path nobody chose is how a stray db.sqlite appears in someone's home
   * directory.
   */
  async ensure(): Promise<Open> {
    if (this.changing) throw new VaultRefused("switching vaults — try again in a moment");
    if (this.open) return this.open;
    const config = await readAppConfig(this.deps.configFile);
    if (!config) throw new NoConfig();
    const { core, store } = openCore(config);
    const runner = new Runner({
      core,
      emit: this.deps.emit,
      finish: this.deps.finish,
      ...(this.deps.now ? { now: this.deps.now } : {}),
    });
    this.open = { config, core, store, runner, opened: new OpenedNotes(config.notesPath) };
    return this.open;
  }

  /**
   * The open vault, but only if it is `vault`.
   *
   * For a write the renderer composed while looking at one vault and sends
   * after it may have been left — an annotation saved as the review screen
   * closes, which a vault switch is one way to cause (ADR 0029). Refused
   * rather than written to whichever vault is open now, where it would sit
   * under an id that belongs to another notes folder.
   */
  async ensureVault(vault: string): Promise<Open> {
    const open = await this.ensure();
    if (open.config.id !== vault) {
      throw new VaultRefused(`that vault is no longer open, so the change was not saved`);
    }
    return open;
  }

  status(): RunStatus {
    return this.open?.runner.status() ?? { state: "never" };
  }

  /**
   * Change the config the open vault came from, then drop everything derived
   * from it.
   *
   * **Refused while a sync or rebuild is running.** `core` takes no
   * `AbortSignal`, which is why there is no cancel button (`docs/design/app.md`),
   * and closing the `Store` under a running job is the one thing this must
   * never do. Refusing says why; waiting would leave a click hanging for as
   * long as a rebuild takes, with nothing on screen to say so.
   *
   * Checked before `write`, not after: a refused switch must not have
   * rewritten the config either, or the next launch would open the vault
   * this said it had not switched to.
   *
   * The notes edited in the vault being left are answered here, because this
   * is the last moment its `OpenedNotes` exists. A review session that is
   * interrupted by a switch never reaches its own end-of-session check.
   */
  async change<T>(write: () => Promise<T>): Promise<{ value: T; left: Left | null }> {
    if (this.changing) throw new VaultRefused("already switching vaults");
    const running = this.open?.runner.status();
    if (running?.state === "running") {
      throw new VaultRefused(
        `a ${running.progress.kind} is running in this vault — wait for it to finish, then try again`,
      );
    }
    this.changing = true;
    try {
      const value = await write();
      const left = this.open
        ? { vault: this.open.config.id, changed: await this.open.opened.changed() }
        : null;
      this.reset();
      return { value, left };
    } finally {
      this.changing = false;
    }
  }

  /**
   * Drop everything derived from the config. The Store is closed rather than
   * abandoned, because the next one may well be a different file.
   */
  reset(): void {
    this.open?.store.close();
    this.open = null;
  }
}
