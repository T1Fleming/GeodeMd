/**
 * How a review card looks. Pure string builders, like `formatSummary` next
 * door: the loop in `index.ts` decides *when* to print and this decides *what*,
 * which is what keeps the output testable without a pseudo-terminal.
 */

import type { DueCard } from "../core/index.js";
import type { Style } from "./style.js";
import { PLAIN, wrap } from "./style.js";

const INDENT = "  ";
const HANGING = "    ";
const MARKER = "▸";
const RULE = "─";

/** The four FSRS ratings are not guessable from their numbers. Spec section 9. */
const RATING_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["1", "again"],
  ["2", "hard"],
  ["3", "good"],
  ["4", "easy"],
];

const ACTION_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["o", "open"],
  ["q", "quit"],
];

/**
 * The key is what you press and the word is what it means, so the key stays
 * legible and the word recedes. Built from one table rather than written out,
 * because a legend that disagrees with `interpretKey` is worse than none.
 */
export function renderLegend(s: Style): string {
  const pair = ([key, label]: readonly [string, string]): string =>
    `${s.bold(key)} ${s.dim(label)}`;
  const ratings = RATING_KEYS.map(pair).join("  ");
  const actions = ACTION_KEYS.map(pair).join(s.dim(" · "));
  return `${ratings}   ${actions}`;
}

/** The uncoloured legend, which is also what the tests read. */
export const LEGEND = renderLegend(PLAIN);

export function renderHeader(queued: number, total: number, s: Style): string {
  return `\n${INDENT}${s.dim(`${queued} of ${total} due`)}\n`;
}

/**
 * Counter, locator, rule, question. The counter is repeated on every card
 * because the one printed at the top of a fifty-card session is no help by
 * card thirty.
 */
export function renderPrompt(
  card: DueCard,
  index: number,
  queued: number,
  s: Style,
  width: number,
): string {
  const head = `${s.dim(`${index}/${queued}`)}   ${s.dim(card.locator)}`;
  const rule = s.dim(RULE.repeat(Math.max(1, width - INDENT.length)));
  const body = wrap(card.question, width - INDENT.length)
    .map((line) => `${INDENT}${s.bold(line)}`)
    .join("\n");
  return `\n${INDENT}${head}\n${INDENT}${rule}\n${body}\n`;
}

export function renderAnswer(card: DueCard, s: Style, width: number): string {
  const lines = wrap(card.answer, width - HANGING.length);
  const body = lines
    .map((line, i) => (i === 0 ? `${INDENT}${s.cyan(MARKER)} ${line}` : `${HANGING}${line}`))
    .join("\n");
  return `\n${body}\n\n${INDENT}${renderLegend(s)}\n`;
}

export interface RatingCounts {
  1: number;
  2: number;
  3: number;
  4: number;
}

export function emptyCounts(): RatingCounts {
  return { 1: 0, 2: 0, 3: 0, 4: 0 };
}

/**
 * Quiet about zero-valued buckets, for the same reason `formatSummary` is: a
 * tally reading "0 again · 0 hard" is noise around the number you wanted.
 */
export function renderSummary(counts: RatingCounts, s: Style): string {
  const done = counts[1] + counts[2] + counts[3] + counts[4];
  const parts = RATING_KEYS.filter(([key]) => counts[Number(key) as 1 | 2 | 3 | 4] > 0).map(
    ([key, label]) => `${counts[Number(key) as 1 | 2 | 3 | 4]} ${label}`,
  );
  const tail = parts.length > 0 ? s.dim(` · ${parts.join(" · ")}`) : "";
  return `\n${INDENT}${done} reviewed${tail}\n`;
}

/** One dim aside under the card — a busy database, an editor that would not run. */
export function renderNote(text: string, s: Style): string {
  return `${INDENT}${s.dim(text)}\n`;
}

/**
 * Said once at the end of a session, for the notes that changed while it ran.
 *
 * Empty string rather than null so the caller can concatenate it with the
 * summary unconditionally. One note is named, because that is the useful thing
 * to know; several are counted, because the line stops being readable.
 */
export function renderStaleNote(paths: string[], s: Style): string {
  if (paths.length === 0) return "";
  const what =
    paths.length === 1 ? `\`${paths[0]}\` changed` : `${paths.length} notes you opened changed`;
  return renderNote(`${what} while you were reviewing — run \`geode sync\``, s);
}
