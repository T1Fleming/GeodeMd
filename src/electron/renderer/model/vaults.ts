/**
 * The vault switcher's decisions, as pure functions
 * ([ADR 0027](../../../../docs/decisions/0027-vaults.md)).
 *
 * The switcher is a `<select>` in the tab bar, always reachable. Choosing a
 * vault already added switches to it at once — its database already exists,
 * so there is nothing to preview. Choosing **Add vault…** is different, and
 * leads into the setup sequence: the first sync of a new vault stamps every
 * card line in its folder, and the preview exists for exactly that.
 */

import type { VaultList, VaultSwitched } from "../../ipc.js";

/** The option that means "add one", which no vault id can collide with. */
export const ADD = "__add__";

export interface Option {
  value: string;
  label: string;
}

/** Every vault by name, in the order they were added, then the way to add one. */
export function switcherOptions(list: VaultList): Option[] {
  return [
    ...list.vaults.map((v) => ({ value: v.id, label: v.name })),
    { value: ADD, label: "Add vault…" },
  ];
}

export type Choice = { kind: "switch"; id: string } | { kind: "add" } | { kind: "none" };

/** What choosing `value` in the switcher does. Re-choosing the open vault does nothing. */
export function choose(list: VaultList, value: string): Choice {
  if (value === ADD) return { kind: "add" };
  if (value === list.active || !list.vaults.some((v) => v.id === value)) return { kind: "none" };
  return { kind: "switch", id: value };
}

/**
 * Why a vault cannot be removed, or null when it can.
 *
 * The open vault cannot: something has to be open afterwards, and which one is
 * the user's call. Main refuses it too; this is so the button can say so
 * rather than fail.
 */
export function cannotRemove(list: VaultList, id: string): string | null {
  return id === list.active ? "This is the open vault. Switch to another before removing it." : null;
}

/**
 * The end-of-session note for the vault just left, or null when there is
 * nothing to say.
 *
 * A switch in the middle of a review ends that session without its own
 * end-of-session check, so main runs the check on the way out and this says
 * what it found — naming the vault, because the notes are no longer the ones
 * on screen.
 */
export function leftNote(left: VaultSwitched["left"], list: VaultList | null): string | null {
  if (!left || left.changed.length === 0) return null;
  const name = list?.vaults.find((v) => v.id === left.vault)?.name ?? "the last vault";
  const n = left.changed.length;
  return `${n} ${n === 1 ? "note" : "notes"} you opened in “${name}” changed — sync that vault to pick ${n === 1 ? "it" : "them"} up.`;
}
