/**
 * Getting from a config file to a live `Core`, on this machine.
 *
 * Both interfaces need exactly this, and neither should retype it — including
 * the named-fields-rather-than-spread decision below, which is load-bearing
 * and easy to "simplify" away.
 */

import { Core } from "../core/index.js";
import { Store } from "../store/index.js";
import { configPath, ensureConfig, newId } from "./config.js";
import type { VaultConfig } from "./config.js";

/**
 * The config for this machine, or null when there is none yet.
 *
 * **Null, not a throw.** A first run is an ordinary state, not an error: a GUI
 * has to tell "no config yet, show onboarding" apart from "something went
 * wrong", and code that decides that by catching an exception eventually shows
 * onboarding after a disk error. The CLI turns the null into its own
 * `ConfigError` at the one place that wants to exit non-zero.
 *
 * `ensureConfig` rather than `readConfig`: anything reached from here can write
 * a review log, and a config with no `device` would otherwise hand out a fresh
 * name every read.
 */
export async function readAppConfig(file = configPath()): Promise<VaultConfig | null> {
  return ensureConfig(file);
}

/**
 * Open the store and wire up a `Core`. The caller owns the `Store` and must
 * close it — the CLI does so in a `finally`, and a long-lived process has to
 * do it on shutdown.
 */
export function openCore(config: VaultConfig): { core: Core; store: Store } {
  const store = new Store(config.dbPath);
  // Named fields rather than a spread: `editor` belongs to whichever interface
  // opens a note and has no place in core's Config. A spread would quietly
  // hand core a field it is not supposed to know about.
  const core = new Core(
    { notesPath: config.notesPath, device: config.device, dbPath: config.dbPath, newId },
    store,
  );
  return { core, store };
}
