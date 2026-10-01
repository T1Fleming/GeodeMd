/**
 * Spec section 3 (card syntax) and the stamp half of section 4 (identity).
 *
 * PURE. No filesystem, no database, no clock. Takes a string, returns objects.
 * Section 6 rule 4 — this is what makes it testable and reusable by a future
 * editor plugin.
 */

export interface ParsedCard {
  /** null until minted. */
  id: string | null;
  question: string;
  answer: string;
  /** 0-based; authoritative for the stamp write (section 6). */
  lineIndex: number;
}

/** `sr-` plus exactly 12 chars from [A-Za-z0-9]. Section 4. */
export const ID_PATTERN = /^sr-[A-Za-z0-9]{12}$/;

/**
 * The only shape that is a stamp: an HTML comment at end of line. Section 4
 * chose a comment over a bare `^token` anchor because it is invisible in every
 * Markdown renderer, and because no amount of ordinary answer text can be
 * mistaken for one.
 */
const STAMP_AT_END = /<!-- (sr-[A-Za-z0-9]{12}) -->[ \t]*$/;

/** Any trailing HTML comment, stamp or not. Section 3 strips all of them. */
const TRAILING_COMMENT = /<!--[\s\S]*?-->[ \t]*$/;

/**
 * A leading list marker: bullet or ordered, each optionally followed by a task
 * box. Section 3 — `- foo :: bar` is how people actually write these and the
 * marker must not end up on the front of the flashcard.
 */
export const LIST_MARKER = /^(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/;

/**
 * The list marker alone, without a task box, and the whitespace after it —
 * what decides the column a list item's text starts at.
 */
const MARKER_ONLY = /^(?:[-*+]|\d{1,9}[.)])(?=[ \t])/;

/** `* * *`, `- - -`, `___`: a horizontal rule, which opens no list item. */
const THEMATIC_BREAK = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/** Columns in a tab stop, as CommonMark counts them. */
const TAB_WIDTH = 4;

/** `::` with whitespace on both sides, so `foo::bar` is not a card. */
const SEPARATOR = /(?<=\s)::(?=\s)/;

/** ``` or ~~~, any length >= 3, with an optional info string. */
const FENCE = /^[ \t]*(`{3,}|~{3,})/;

/**
 * Extract a stamp from the end of a line.
 * Returns the id and the line with the stamp removed, or null if unstamped.
 */
export function readStamp(line: string): { id: string; rest: string } | null {
  const m = STAMP_AT_END.exec(line);
  if (!m) return null;
  return { id: m[1]!, rest: line.slice(0, m.index) };
}

/**
 * Produce the stamped form of a line.
 *
 * Section 4: "Re-minting replaces the existing stamp; it never appends a second
 * one." The naive implementation appends and produces `<!-- sr-old --> <!--
 * sr-new -->`, so replacement is written explicitly here rather than left to
 * the caller.
 *
 * The line's own terminator is not this function's business — section 8 step 4
 * requires each line to keep the terminator it had, so callers pass the line
 * body only.
 */
export function stampLine(line: string, id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error(`not a valid card id: ${id}`);
  const existing = readStamp(line);
  const base = existing ? existing.rest.replace(/[ \t]+$/, "") : line.replace(/[ \t]+$/, "");
  return `${base} <!-- ${id} -->`;
}

/** Split text into lines that each keep their own terminator (section 8 step 4). */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.split(/(?<=\r?\n)/);
}

/** The line body without its trailing CR/LF. */
function body(line: string): string {
  return line.replace(/\r?\n$/, "");
}

/**
 * Is the separator at `index` inside an inline code span?
 *
 * Section 3 uses one line-level predicate: an odd number of backticks before it.
 * `` Use `foo :: bar` to declare it `` is prose about a syntax, not a card.
 */
function insideCodeSpan(line: string, index: number): boolean {
  let ticks = 0;
  for (let i = 0; i < index; i++) if (line[i] === "`") ticks++;
  return ticks % 2 === 1;
}

/**
 * Parse the card on a single line, ignoring block context.
 * Exported for tests and for the sync pass, which re-checks one line after a
 * move-versus-copy decision. Returns null when the line is not a card.
 */
export function parseLine(raw: string, lineIndex: number): ParsedCard | null {
  const line = body(raw);

  const sep = SEPARATOR.exec(line);
  if (!sep) return null;
  if (insideCodeSpan(line, sep.index)) return null;

  const rawQuestion = line.slice(0, sep.index);
  let rawAnswer = line.slice(sep.index + 2);

  // The stamp comes off first so that it is not mistaken for answer text, then
  // any other trailing comments (`<!-- TODO check -->`) come off too.
  const stamp = readStamp(rawAnswer);
  let id: string | null = null;
  if (stamp) {
    id = stamp.id;
    rawAnswer = stamp.rest;
  }
  let answer = rawAnswer;
  let prev: string;
  do {
    prev = answer;
    answer = answer.replace(TRAILING_COMMENT, "");
  } while (answer !== prev);

  const question = rawQuestion.replace(/^[ \t]*/, "").replace(LIST_MARKER, "").trim();
  answer = answer.trim();

  if (question === "" || answer === "") return null;
  return { id, question, answer, lineIndex };
}

/** The column after `text`, starting from column `from`, with tabs expanded. */
function columnAfter(text: string, from: number): number {
  let col = from;
  for (const ch of text) col = ch === "\t" ? col + TAB_WIDTH - (col % TAB_WIDTH) : col + 1;
  return col;
}

/**
 * Where a list item's text starts, or null when the line does not open one.
 * `indent` is the column the marker sits at. As in CommonMark, five or more
 * columns of space after the marker mean the text starts one column after it
 * and the rest is indentation of the text itself.
 */
function listContentColumn(rest: string, indent: number): number | null {
  const m = MARKER_ONLY.exec(rest);
  if (!m || THEMATIC_BREAK.test(rest)) return null;
  const markerEnd = indent + m[0].length;
  const gap = /^[ \t]+/.exec(rest.slice(m[0].length))![0];
  const textStart = columnAfter(gap, markerEnd);
  return textStart - markerEnd > 4 ? markerEnd + 1 : textStart;
}

/**
 * The index of the line closing a YAML frontmatter block, or -1 when the note
 * has none.
 *
 * Frontmatter only counts when `---` opens line 1. Without a closing
 * delimiter the file has no frontmatter — do not swallow the whole note.
 */
export function frontmatterEndOf(lines: readonly string[]): number {
  if (lines.length === 0 || body(lines[0]!).trim() !== "---") return -1;
  for (let i = 1; i < lines.length; i++) {
    if (body(lines[i]!).trim() === "---") return i;
  }
  return -1;
}

/**
 * Parse a whole document.
 *
 * The skip list in section 3 is longer than a card parser looks like it needs,
 * and the reason is section 8 step 4: a false positive here does not merely
 * produce a junk card, it writes a stamp into the user's note.
 */
export function parse(text: string): ParsedCard[] {
  const lines = splitLines(text);
  const cards: ParsedCard[] = [];

  let fence: string | null = null;
  // The column each open list item's text starts at, outermost first. A line
  // indented past the innermost one sits inside it (ADR 0030).
  const open: number[] = [];
  const frontmatterEnd = frontmatterEndOf(lines);
  let inFrontmatter = frontmatterEnd !== -1;

  for (let i = 0; i < lines.length; i++) {
    const line = body(lines[i]!);

    if (inFrontmatter) {
      if (i <= frontmatterEnd) continue;
      inFrontmatter = false;
    }

    const lead = /^[ \t]*/.exec(line)![0];
    const rest = line.slice(lead.length);
    if (rest === "" && fence === null) continue;
    const indent = columnAfter(lead, 0);

    // A line closes every open list item whose text starts to its right.
    if (fence === null) while (open.length > 0 && open[open.length - 1]! > indent) open.pop();

    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence === null) {
        fence = marker[0]!;
        continue;
      }
      // A closing fence must use the same character; length may differ.
      if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;

    // Indented code block: four or more columns past the text of the list
    // item it sits in, or past the margin outside a list (ADR 0030). Deeper
    // than that is code to Markdown too, so it is never read as a card.
    const container = open.length > 0 ? open[open.length - 1]! : 0;
    if (indent - container >= 4) continue;
    const contentColumn = listContentColumn(rest, indent);
    // A list item may sit four or more columns from the margin, nested under
    // another one (#60). Anything else that deep stays skipped, as it always
    // was: when it is unclear whether a line is code, it is not a card.
    if (indent >= 4 && contentColumn === null) continue;
    // Table row.
    if (/^[ \t]*\|/.test(line)) continue;
    // Blockquote or heading.
    if (/^[ \t]*[>#]/.test(line)) continue;

    if (contentColumn !== null) open.push(contentColumn);
    const card = parseLine(lines[i]!, i);
    if (card) cards.push(card);
  }

  return cards;
}
