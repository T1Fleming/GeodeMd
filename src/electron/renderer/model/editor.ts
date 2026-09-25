/**
 * The Editor row on the Vault screen, as pure functions.
 *
 * The same split as `run.ts` and `setup.ts`: no React, no IPC. The one real
 * decision here is what to show when the config names an editor that is not
 * in the detected list — a typed command, or an editor since uninstalled.
 * Showing it as *System default* would be a lie about what `o` does, and
 * dropping it silently would lose it on the next save, so it shows as
 * **Other…** with the value in the box.
 */

import type { EditorChoices } from "../../ipc.js";

/** The select's value for "no `editor` key". Not a command anyone could type. */
export const SYSTEM_DEFAULT = "";
/** The select's value for a typed command. */
export const OTHER = "\u0000other";

export interface EditorOption {
  value: string;
  label: string;
}

export interface EditorView {
  options: EditorOption[];
  selected: string;
  /** The typed command, shown when `selected` is `OTHER`. */
  other: string;
}

export function editorView(choices: EditorChoices): EditorView {
  const options: EditorOption[] = [
    { value: SYSTEM_DEFAULT, label: "System default" },
    ...choices.detected.map((e) => ({ value: e.command, label: e.label })),
    { value: OTHER, label: "Other…" },
  ];
  const current = choices.current;
  if (current === null) return { options, selected: SYSTEM_DEFAULT, other: "" };
  if (choices.detected.some((e) => e.command === current)) {
    return { options, selected: current, other: "" };
  }
  return { options, selected: OTHER, other: current };
}

/**
 * What choosing an option saves, or undefined when choosing it saves nothing
 * yet — **Other…** waits for a command to be typed.
 */
export function onChoose(value: string): string | null | undefined {
  if (value === OTHER) return undefined;
  return value === SYSTEM_DEFAULT ? null : value;
}
