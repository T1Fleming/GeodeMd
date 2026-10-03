/**
 * An exercise: a note opted in by its properties, scheduled by the skills it
 * names ([ADR 0038](../../docs/decisions/0038-exercises.md)).
 *
 * PURE, like the rest of the parser: text in, data out. Unlike a card, an
 * exercise is the whole note rather than a line, and nothing is ever written
 * back into it — no stamp, so the false positive the card skip list guards
 * against cannot happen here.
 */

import { parse as parseYaml } from "yaml";
import { frontmatterEndOf, ID_PATTERN, splitLines } from "./index.js";

/**
 * Which rules a note is read as an exercise by. Bump it whenever the same note
 * would yield a different exercise, so every vault re-reads every note once —
 * as `CONTEXT_VERSION` does, and with no warning, because nothing is stamped.
 */
export const EXERCISE_VERSION = "3";

/** The property that makes a note an exercise. */
export const SKILLS_KEY = "geode-skills";

/**
 * The property holding an exercise's id, written by sync (ADR 0041), in the
 * cards' format. With `geode-skills`, the only properties GeodeMD reads.
 */
export const ID_KEY = "geode-id";

/** A `geode-id` line at the top level of the properties block. */
const ID_LINE = /^geode-id[ \t]*:/;

/**
 * What a note is, read as an exercise.
 *
 * - `none`: an ordinary note. No properties, or none named `geode-skills`, or
 *   an empty list — an exercise not yet tagged.
 * - `exercise`: in every pool it names. `title` is null when the note has no
 *   `# ` heading, and the caller falls back to the file's name. `id` is null
 *   until sync has written one, or when the value is not a valid id.
 * - `unreadable`: the properties do not parse, or `geode-skills` is not a list
 *   of strings. Reported, never an error.
 * - `no-solution`: tagged, but nothing marks where the statement ends, so a
 *   spot review would show the solution. Reported and left out of every pool.
 */
export type ParsedExercise =
  | { kind: "none" }
  | { kind: "exercise"; skills: string[]; id: string | null; title: string | null; statement: string }
  | { kind: "unreadable" }
  | { kind: "no-solution"; skills: string[] };

/** `## Solution`, any case, with optional closing `#`s. */
const SOLUTION = /^##[ \t]+solution(?:[ \t]+#+)?[ \t]*$/i;

/**
 * Headings that give the answer away as surely as the solution does, and so
 * end the statement too (ADR 0039). Notes clipped from LeetCode, or written
 * after one, put "Intuition" or "Approach" above the code; shown on the
 * question screen, they name the skill before it is asked. A short list on
 * purpose: "## Examples" or "## Constraints" are part of the problem.
 */
const SPOILER = /^##[ \t]+(?:solution|intuition|approach|hints?|explanation)(?:[ \t]+#+)?[ \t]*$/i;

/** A level-1 ATX heading, and its text. */
const TITLE = /^#[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/** ``` or ~~~, as the card parser reads a fence. */
const FENCE = /^[ \t]*(`{3,}|~{3,})/;

export function parseExercise(text: string): ParsedExercise {
  const lines = splitLines(text);
  const end = frontmatterEndOf(lines);
  if (end === -1) return { kind: "none" };

  const yaml = lines.slice(1, end).join("");
  // Most notes with properties are not exercises. Not parsing theirs keeps
  // sync's cost where it was, and keeps a malformed block in a note that never
  // asked to be an exercise from being reported as one.
  if (!yaml.includes(SKILLS_KEY)) return { kind: "none" };

  let props: unknown;
  try {
    props = parseYaml(yaml);
  } catch {
    return { kind: "unreadable" };
  }
  if (props === null || typeof props !== "object" || Array.isArray(props)) return { kind: "unreadable" };
  if (!(SKILLS_KEY in props)) return { kind: "none" };

  const skills = skillsOf((props as Record<string, unknown>)[SKILLS_KEY]);
  if (skills === null) return { kind: "unreadable" };
  if (skills.length === 0) return { kind: "none" };

  const body = statementOf(lines.slice(end + 1).map((l) => l.replace(/\r?\n$/, "")));
  if (body === null) return { kind: "no-solution", skills };
  const raw = (props as Record<string, unknown>)[ID_KEY];
  const id = typeof raw === "string" && ID_PATTERN.test(raw.trim()) ? raw.trim() : null;
  return { kind: "exercise", skills, id, ...body };
}

/**
 * The note with `geode-id: <id>` in its properties (ADR 0041), changed by one
 * line and nothing else: an existing top-level `geode-id` line gets the new
 * value, and otherwise a line is added just before the closing `---`, with the
 * block's own line ending. The YAML is never re-serialised, which would
 * reformat the user's properties. A note with no properties block comes back
 * unchanged; it is not an exercise.
 */
export function stampExerciseId(text: string, id: string): string {
  const lines = splitLines(text);
  const end = frontmatterEndOf(lines);
  if (end === -1) return text;
  for (let i = 1; i < end; i++) {
    if (ID_LINE.test(lines[i]!)) {
      lines[i] = `${ID_KEY}: ${id}${/\r?\n$/.exec(lines[i]!)?.[0] ?? ""}`;
      return lines.join("");
    }
  }
  const eol = /\r?\n$/.exec(lines[0]!)?.[0] ?? "\n";
  lines.splice(end, 0, `${ID_KEY}: ${id}${eol}`);
  return lines.join("");
}

/** A list of non-blank strings, trimmed and de-duplicated in order; null for anything else. */
function skillsOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string" || v.trim() === "") return null;
    const skill = v.trim();
    if (!out.includes(skill)) out.push(skill);
  }
  return out;
}

/**
 * The title and the statement: the first `# ` heading, and the text after it up
 * to the first spoiler heading (`## Solution`, `## Approach`, …). Null when
 * there is no `## Solution`: a note must still say where its answer is.
 *
 * Headings inside a fenced block are code, not structure, so a statement that
 * quotes Markdown cannot end itself early. A note without a `# ` heading has
 * its statement start straight after the properties.
 */
function statementOf(lines: string[]): { title: string | null; statement: string } | null {
  let fence: string | null = null;
  let title: string | null = null;
  let start = 0;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const f = FENCE.exec(line);
    if (f) {
      if (fence === null) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    if (end === -1 && SPOILER.test(line)) end = i;
    if (SOLUTION.test(line)) {
      return { title, statement: lines.slice(start, end).join("\n").trim() };
    }
    if (end !== -1) continue;
    const t: RegExpExecArray | null = title === null ? TITLE.exec(line) : null;
    if (t && t[1]!.trim() !== "") {
      title = t[1]!.trim();
      start = i + 1;
    }
  }
  return null;
}
