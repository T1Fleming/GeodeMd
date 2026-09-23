/**
 * Writes `docs/design/behaviours.md` from the test run that just happened.
 *
 * The suite already states what GeodeMD does, 444 sentences at a time, in the
 * names of its tests. What it could not do was be *read* — the sentences are
 * spread over 25 files in source order. This assembles them: area, then group,
 * then behaviour, using `areas.ts` for the first level.
 *
 * **A reporter rather than a script, and that is the whole point.** A document
 * generated on demand is a document nobody regenerates; this one is rewritten by
 * the suite everyone already runs, so a change in behaviour turns up as a diff in
 * review next to the code that caused it, and a stale copy shows up as an
 * uncommitted change in `git status`. There is no CI here today; when there is,
 * `npm test && git diff --exit-code docs/design/behaviours.md` is the whole
 * enforcement.
 *
 * It writes nothing when the run was filtered, which matters more than it looks:
 * `npx vitest run src/host/queue.test.ts` would otherwise rewrite the document
 * with one file's behaviours and silently delete the rest.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AREAS, areaFor } from "./areas.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..");
const OUT = path.join(SRC, "..", "docs", "design", "behaviours.md");

/**
 * Only what is needed from vitest's task tree, declared locally.
 *
 * Importing vitest's own `Reporter` and `Task` types would tie this file to the
 * shape of an internal API across versions, for no gain: three fields are used.
 */
interface Task {
  type: string;
  name: string;
  mode?: string;
  tasks?: Task[];
  result?: { state?: string };
}
interface RunFile extends Task {
  filepath: string;
}

interface Behaviour {
  title: string;
  /** `skip` is worth showing: a behaviour that is written down but not proven. */
  skipped: boolean;
}

/** One top-level `describe` in one file. Never merged across files. */
interface Section {
  area: string;
  file: string;
  /** The top-level `describe` — the heading. */
  top: string;
  /** Nested `describe`s below it, if any, in source order. */
  blocks: Array<{ path: string[]; behaviours: Behaviour[] }>;
}

/** Every test file on disk, so a filtered run can be recognised as one. */
function countTestFiles(dir: string): number {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countTestFiles(path.join(dir, entry.name));
    else if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) n++;
  }
  return n;
}

/**
 * One file's task tree, flattened into sections in source order.
 *
 * Sections are keyed by file AND top-level name, never merged by name alone:
 * `interpretKey` is a group in two files, and merging them produced a heading
 * with ten behaviours under it and no way to tell which four came from where.
 */
function sectionsIn(file: RunFile, unclassified: string[]): Section[] {
  const rel = path.relative(SRC, file.filepath);
  const sections: Section[] = [];

  const walk = (task: Task, chain: string[]): void => {
    if (task.type === "suite") {
      for (const child of task.tasks ?? []) walk(child, [...chain, task.name]);
      return;
    }
    // A test with no `describe` around it still needs a home.
    const top = chain[0] ?? "(ungrouped)";
    const rest = chain.slice(1);

    let section = sections.find((s) => s.top === top);
    if (!section) {
      const area = areaFor(rel, top);
      if (!area) {
        const key = `${rel}:${top}`;
        if (!unclassified.includes(key)) unclassified.push(key);
        return;
      }
      sections.push((section = { area, file: rel, top, blocks: [] }));
    }

    let block = section.blocks.find((b) => b.path.join(" › ") === rest.join(" › "));
    if (!block) section.blocks.push((block = { path: rest, behaviours: [] }));
    block.behaviours.push({
      title: task.name,
      skipped: task.mode === "skip" || task.mode === "todo" || task.result?.state === "skip",
    });
  };

  for (const task of file.tasks ?? []) walk(task, []);
  return sections;
}

const size = (s: Section): number => s.blocks.reduce((n, b) => n + b.behaviours.length, 0);

function render(files: RunFile[]): string {
  const unclassified: string[] = [];
  const sections = files.flatMap((f) => sectionsIn(f, unclassified));
  const total = sections.reduce((n, s) => n + size(s), 0);

  // Grouped by area, in `AREAS` order; within an area by file path, and within a
  // file in source order — so a reader following a behaviour into the code lands
  // in one place rather than hopping between files.
  const byArea = new Map<string, Section[]>();
  for (const area of AREAS) {
    const mine = sections.filter((s) => s.area === area.name);
    if (mine.length > 0) {
      byArea.set(
        area.name,
        [...mine].sort((a, b) => (a.file === b.file ? 0 : a.file.localeCompare(b.file))),
      );
    }
  }

  const lines: string[] = [
    "# Behaviours",
    "",
    "**Generated. Do not edit.** Every line below is the name of a test, assembled by",
    "`src/behaviours/reporter.ts` from the run that `npm test` just performed — so this",
    "file cannot describe a behaviour the suite does not check. `npm test` rewrites it, so",
    "a change here in a diff is a change in what GeodeMD does, and a stale copy shows up",
    "as an uncommitted change.",
    "",
    "It answers two questions the suite, organised by module, could not: *what does this",
    "app do*, and *where is that proven*. What it deliberately cannot tell you is what the",
    "app does **untested** — an area that looks thin here is thinly covered, and that is",
    "worth reading as a finding rather than a gap in the document.",
    "",
    `${total} behaviours in ${byArea.size} areas, which follow [the guides](../guides/) rather than the source tree.`,
    "",
  ];

  for (const area of AREAS) {
    const mine = byArea.get(area.name);
    if (!mine) continue;
    const n = mine.reduce((m, s) => m + size(s), 0);
    lines.push(`- [${area.name}](#${anchor(area.name)}) — ${n}`);
  }
  lines.push("");

  for (const area of AREAS) {
    const mine = byArea.get(area.name);
    if (!mine) continue;
    const n = mine.reduce((m, s) => m + size(s), 0);
    lines.push(`## ${area.name}`, "", `_${area.blurb}_`, "", `**${n} behaviours.**`, "");

    for (const section of mine) {
      lines.push(`### ${section.top}`, "", `_${size(section)} · \`${section.file}\`_`, "");
      for (const block of section.blocks) {
        if (block.path.length > 0) lines.push(`**${block.path.join(" › ")}**`, "");
        for (const b of block.behaviours) {
          lines.push(`- ${b.title}${b.skipped ? " _(skipped)_" : ""}`);
        }
        lines.push("");
      }
    }
  }

  if (unclassified.length > 0) {
    // Should be unreachable: `areas.test.ts` fails first. Written anyway, because
    // a document that silently drops behaviours is worse than an ugly one.
    lines.push("## Unclassified", "", "No area in `src/behaviours/areas.ts` covers these:", "");
    for (const u of unclassified.sort()) lines.push(`- \`${u}\``);
    lines.push("");
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

/** GitHub's heading anchors, for the contents list. */
function anchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export default class BehavioursReporter {
  onFinished(files: RunFile[] = []): void {
    // A filtered run knows less than the document already holds, so it must not
    // overwrite it. `-t` narrows tests within a file and cannot be detected here
    // by counting, which is why the count check is a floor rather than a promise:
    // an incomplete run is common, and losing the document to one is not
    // recoverable from the run that caused it.
    const complete = files.length >= countTestFiles(SRC);
    if (!complete) return;

    const ran = files.filter((f) => (f.tasks ?? []).length > 0);
    const next = render([...ran].sort((a, b) => a.filepath.localeCompare(b.filepath)));
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (current !== next) fs.writeFileSync(OUT, next, "utf8");
  }
}
