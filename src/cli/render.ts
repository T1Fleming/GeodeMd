/**
 * How a review card looks. Pure string builders, like `formatSummary` next
 * door: the loop in `index.ts` decides *when* to print and this decides *what*,
 * which is what keeps the output testable without a pseudo-terminal.
 */

import type { DueCard } from "../core/index.js";
import {
  actionsAt,
  emptyCounts,
  RATING_KEYS,
  ratingBreakdown,
} from "../host/present.js";
import type { RatingCounts } from "../host/present.js";
import type { Style } from "./style.js";
import { PLAIN, wrap } from "./style.js";

export { emptyCounts };
export type { RatingCounts };

const INDENT = "  ";
const HANGING = "    ";
const MARKER = "▸";
const RULE = "─";

/**
 * The key is what you press and the word is what it means, so the key stays
 * legible and the word recedes. Built from one table rather than written out,
 * because a legend that disagrees with `interpretKey` is worse than none.
 */
export function renderLegend(s: Style): string {
  const ratings = RATING_KEYS.map(([key, label]) => pair(key, label, s)).join("  ");
  const actions = actionsAt("answer")
    .map((a) => pair(a.key, a.label, s))
    .join(s.dim(" · "));
  return `${ratings}   ${actions}`;
}

/**
 * What is on offer while the answer is still hidden.
 *
 * Its own function rather than a slice of the one above, because the two
 * stages advertise genuinely different things: there are no ratings here, and
 * `0` exists only here. Which keys belong to which stage is `host`'s to say —
 * this only decides how they look.
 */
export function renderPromptLegend(s: Style): string {
  return actionsAt("question")
    .map((a) => pair(a.key, a.label, s))
    .join(s.dim(" · "));
}

function pair(key: string, label: string, s: Style): string {
  return `${s.bold(key)} ${s.dim(label)}`;
}

/** The uncoloured legends, which are also what the tests read. */
export const LEGEND = renderLegend(PLAIN);
export const PROMPT_LEGEND = renderPromptLegend(PLAIN);

/**
 * `12 of 400 due`. The total arrives as TEXT, because a count that stopped at
 * the cap reads `10000+` and deciding that is `host`'s job, not this file's
 * (ADR 0024).
 */
export function renderHeader(queued: number, total: string, s: Style): string {
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
  return `\n${INDENT}${head}\n${INDENT}${rule}\n${body}\n\n${INDENT}${renderPromptLegend(s)}\n`;
}

export function renderAnswer(card: DueCard, s: Style, width: number): string {
  const lines = wrap(card.answer, width - HANGING.length);
  const body = lines
    .map((line, i) => (i === 0 ? `${INDENT}${s.cyan(MARKER)} ${line}` : `${HANGING}${line}`))
    .join("\n");
  return `\n${body}\n\n${INDENT}${renderLegend(s)}\n`;
}

/**
 * Quiet about zero-valued buckets, for the same reason `formatSummary` is: a
 * tally reading "0 again · 0 hard" is noise around the number you wanted.
 */
export function renderSummary(counts: RatingCounts, s: Style): string {
  const done = counts[1] + counts[2] + counts[3] + counts[4];
  // Which buckets to mention is policy and lives in `host`; turning them into
  // a dimmed sentence is this file's business.
  const parts = ratingBreakdown(counts).map(({ label, count }) => `${count} ${label}`);
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
