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
import { frontmatterEndOf, splitLines } from "./index.js";

/**
 * Which rules a note is read as an exercise by. Bump it whenever the same note
 * would yield a different exercise, so every vault re-reads every note once —
 * as `CONTEXT_VERSION` does, and with no warning, because nothing is stamped.
 */
export const EXERCISE_VERSION = "1";

/** The property that makes a note an exercise, and the only one read. */
export const SKILLS_KEY = "geode-skills";

/**
 * What a note is, read as an exercise.
 *
 * - `none`: an ordinary note. No properties, or none named `geode-skills`, or
 *   an empty list — an exercise not yet tagged.
 * - `exercise`: in every pool it names. `title` is null when the note has no
 *   `# ` heading, and the caller falls back to the file's name.
 * - `unreadable`: the properties do not parse, or `geode-skills` is not a list
 *   of strings. Reported, never an error.
 * - `no-solution`: tagged, but nothing marks where the statement ends, so a
 *   spot review would show the solution. Reported and left out of every pool.
 */
export type ParsedExercise =
  | { kind: "none" }
  | { kind: "exercise"; skills: string[]; title: string | null; statement: string }
  | { kind: "unreadable" }
  | { kind: "no-solution"; skills: string[] };

/** `## Solution`, any case, with optional closing `#`s. */
const SOLUTION = /^##[ \t]+solution(?:[ \t]+#+)?[ \t]*$/i;

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
  return { kind: "exercise", skills, ...body };
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
 * to `## Solution`. Null when there is no `## Solution`.
 *
 * Headings inside a fenced block are code, not structure, so a statement that
 * quotes Markdown cannot end itself early. A note without a `# ` heading has
 * its statement start straight after the properties.
 */
function statementOf(lines: string[]): { title: string | null; statement: string } | null {
  let fence: string | null = null;
  let title: string | null = null;
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const f = FENCE.exec(line);
    if (f) {
      if (fence === null) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    if (SOLUTION.test(line)) {
      return { title, statement: lines.slice(start, i).join("\n").trim() };
    }
    const t: RegExpExecArray | null = title === null ? TITLE.exec(line) : null;
    if (t && t[1]!.trim() !== "") {
      title = t[1]!.trim();
      start = i + 1;
    }
  }
  return null;
}
