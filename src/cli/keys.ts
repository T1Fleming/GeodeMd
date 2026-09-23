/**
 * What a terminal keypress is, in the vocabulary `host` speaks.
 *
 * `interpretKey` decides what a key *means* — that is shared, and neither
 * interface may re-decide it. What is not shared is how a keypress arrives: the
 * renderer gets `event.key` from the DOM and hands it straight over, while the
 * CLI gets readline's `(str, key)` pair, in which the same keystroke can turn up
 * as a printable character, a control byte, or a word.
 *
 * This is that translation, and it is a separate file because it was a bug. The
 * loop passed `str` through, which for Escape is the raw `\x1b` byte — so
 * `interpretKey` saw a key it did not recognise and the CLI silently revealed the
 * answer while the app, passing the DOM's `"Escape"`, quit. `host` had said
 * escape quits all along. Nothing was wrong with the vocabulary; the wiring in
 * front of it had no test, because it sat inside a function that needs a
 * pseudo-terminal to reach.
 *
 * Pure, so it needs no terminal at all — the same split `render.ts` has from
 * `index.ts`, one layer further in.
 */

import { interpretKey } from "../host/present.js";

/** As much of readline's key event as this needs. */
export interface Keypress {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

/**
 * Key names `host` understands as words rather than as characters.
 *
 * A list, and a short one on purpose: everything printable should pass through as
 * typed, so `1` stays `1` and an unknown key stays unknown. `keys.test.ts`
 * asserts that every name here is one `interpretKey` actually honours, which is
 * what stops this becoming a second, drifting key table.
 */
const NAMED = new Set(["escape"]);

/** Ctrl-C, as a character. `host` reads it as a quit; `name` would read as "c". */
const ETX = "\u0003";

export function keyFromKeypress(str: string | undefined, key: Keypress = {}): string {
  // Ctrl-C arrives with `name: "c"`, which on its own is an unrecognised key at a
  // rating prompt — the one case where the modifier changes the meaning entirely.
  if (key.ctrl && key.name === "c") return ETX;
  if (key.name !== undefined && NAMED.has(key.name)) return key.name;
  return str ?? key.name ?? "";
}

/** For the test, and for anyone adding a name: the words this translates. */
export const NAMED_KEYS: readonly string[] = [...NAMED];

/** True when `host` does something with this key — used to police `NAMED`. */
export function honoured(key: string): boolean {
  return interpretKey(key).kind !== "ignore";
}
