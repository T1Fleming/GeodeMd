/**
 * Taking a vault out of the app (ADR 0035): unlink it, or erase GeodeMD from
 * its notes as well. No Electron imports, so it tests under plain vitest, the
 * same posture as `runs.ts` and `active.ts`.
 *
 * Any vault may go, the open one included. The open one goes through
 * `Active.change`, which refuses while a run is in flight and closes its Store
 * before anything is deleted from under it.
 */

import { readSettings, removeDatabase, removeVault, VaultRefused } from "../../host/config.js";
import type { Settings, Vault } from "../../host/config.js";
import { eraseNotesFolder, previewErase } from "../../host/erase.js";
import type { ErasePreview } from "../../host/erase.js";
import type { Active } from "./active.js";

export interface RemovalDeps {
  configFile: string;
  active: Pick<Active, "change">;
}

async function vaultOf(configFile: string, id: string): Promise<{ vault: Vault; open: boolean }> {
  const s = await readSettings(configFile);
  const vault = s?.vaults.find((v) => v.id === id);
  if (!s || !vault) throw new VaultRefused("that vault is not in the list any more");
  return { vault, open: s.active === id };
}

/**
 * Run `work` with the vault closed when it is the open one, as-is otherwise.
 * `work` runs inside `Active.change`, so a refusal there leaves everything as
 * it was.
 */
async function closedFor<T>(deps: RemovalDeps, open: boolean, work: () => Promise<T>): Promise<T> {
  return open ? (await deps.active.change(work)).value : work();
}

/**
 * Remove a vault from the app, and its database if asked. Its notes and `.sr/`
 * are left alone. Null when no vault is left, which the app reads as first-run
 * setup.
 */
export async function unlink(deps: RemovalDeps, id: string, deleteDatabase: boolean): Promise<Settings | null> {
  const { open } = await vaultOf(deps.configFile, id);
  const { removed, settings } = await closedFor(deps, open, () => removeVault(deps.configFile, id));
  if (deleteDatabase) await removeDatabase(removed);
  return settings;
}

export async function erasePreview(deps: RemovalDeps, id: string): Promise<ErasePreview> {
  const { vault } = await vaultOf(deps.configFile, id);
  return previewErase(vault.notesPath);
}

/**
 * Erase GeodeMD from a vault entirely: every stamp out of its notes, `.sr/`
 * deleted, then the vault out of the list and its database deleted.
 *
 * `typed` must be the vault's name. The renderer asks for it, and it is
 * checked here too, because this edits notes and cannot be undone.
 */
export async function erase(deps: RemovalDeps, id: string, typed: string): Promise<Settings | null> {
  const { vault, open } = await vaultOf(deps.configFile, id);
  if (typed.trim() !== vault.name) throw new VaultRefused(`type “${vault.name}” to erase it`);
  const { removed, settings } = await closedFor(deps, open, async () => {
    await eraseNotesFolder(vault.notesPath);
    return removeVault(deps.configFile, id);
  });
  await removeDatabase(removed);
  return settings;
}
