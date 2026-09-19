/**
 * Terminal presentation primitives. Terminal I/O, so `cli` is where they live
 * (section 6 rule 2) — nothing below this directory may import them.
 *
 * Hand-rolled rather than a dependency: this is eighty lines against a project
 * with three runtime dependencies, and every one of those is load-bearing.
 */

/** The readable width of a column of prose, whatever the window is doing. */
const MIN_WIDTH = 40;
const MAX_WIDTH = 100;

/** Written this way so no literal control byte ever sits in the source. */
const ESC = String.fromCharCode(27);

export interface Style {
  dim: (s: string) => string;
  bold: (s: string) => string;
  cyan: (s: string) => string;
  green: (s: string) => string;
}

const identity = (s: string): string => s;

const sgr =
  (code: string) =>
  (s: string): string =>
    `${ESC}[${code}m${s}${ESC}[0m`;

/**
 * Colour is a guess about the receiver, so every signal that says "not a
 * terminal" wins over the one that says "probably". NO_COLOR beats FORCE_COLOR
 * deliberately: the former is a user saying no, the latter is usually a script.
 */
export function colorEnabled(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return false;
  if (env["TERM"] === "dumb") return false;
  if (env["FORCE_COLOR"] !== undefined && env["FORCE_COLOR"] !== "") return true;
  return isTTY;
}

/**
 * Disabled styling is the identity function, not a stripped escape sequence.
 * That is what lets the render tests assert plain strings.
 */
export function styler(enabled: boolean): Style {
  if (!enabled) return { dim: identity, bold: identity, cyan: identity, green: identity };
  return { dim: sgr("2"), bold: sgr("1"), cyan: sgr("36"), green: sgr("32") };
}

/** The plain style, for anywhere a Style is needed but colour is not. */
export const PLAIN = styler(false);

/**
 * The text column, which is not the window: prose set across a maximised
 * terminal is unreadable, and a very narrow window would otherwise wrap to one
 * word per line.
 */
export function columns(stdout: { columns?: number | undefined }): number {
  // A zero or missing width means "unknown", which is 80 — not the minimum.
  // Both happen in practice: a pipe has no width, and a pty opened without a
  // winsize reports 0.
  const raw = stdout.columns;
  const known = raw === undefined || !Number.isFinite(raw) || raw <= 0 ? 80 : raw;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, known));
}

/**
 * Word wrap. A word longer than the width — a URL, a long identifier — is hard
 * broken rather than allowed to run off the edge, because the alternative is
 * the ragged overflow this whole module exists to remove.
 */
export function wrap(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];

  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (rest.length > w) {
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(rest.slice(0, w));
        rest = rest.slice(w);
      }
      if (!line) line = rest;
      else if (line.length + 1 + rest.length <= w) line = `${line} ${rest}`;
      else {
        out.push(line);
        line = rest;
      }
    }
    out.push(line);
  }
  return out;
}
