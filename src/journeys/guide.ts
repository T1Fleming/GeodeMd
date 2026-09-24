/**
 * Reading claims back out of `docs/guides/`.
 *
 * The journeys beside this file are the outer tier of the suite: a small set of
 * tests that follow what a *user* does, where the rest of the suite covers how a
 * module behaves. What makes them worth having separately is that each one is
 * anchored to a sentence, a table or an example in a guide — so the guide and the
 * code fail together rather than drifting apart, which is the one thing prose
 * documentation cannot do for itself.
 *
 * The pattern is not new here. `demo.test.ts` exists because
 * `demo/geodemd/syntax.md` claims a set of shapes are skipped, and something had
 * to check that the claim was still true. This is that idea pointed at the
 * documentation users actually read.
 *
 * Deliberately a handful of dumb extractors rather than a Markdown parser: a
 * dependency that understands Markdown would be a second way to read these files,
 * and the point is to read exactly what a person reads.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const GUIDES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "guides");

export async function guide(name: string): Promise<string> {
  return fs.readFile(path.join(GUIDES, name), "utf8");
}

/**
 * The contents of every fenced block, optionally only those of one language.
 *
 * The examples in a guide are the part a reader copies, so they are the part most
 * worth checking: `first-sync.md` shows three lines it says are cards and one it
 * says is not, and the parser has the final word on all four.
 */
export function fences(text: string, lang?: string): string[] {
  const out: string[] = [];
  const re = /^```(\w*)\n([\s\S]*?)^```/gm;
  for (const m of text.matchAll(re)) {
    if (lang === undefined || m[1] === lang) out.push(m[2]!);
  }
  return out;
}

/**
 * Rows of the first Markdown table after `heading`, as trimmed cells.
 *
 * Header and separator rows are dropped. A guide's tables are where it makes its
 * most checkable promises — which key means what, where a file lives — and they
 * are also what a reader trusts most, because a table looks authoritative.
 */
export function tableAfter(text: string, heading: string): string[][] {
  const at = text.indexOf(heading);
  if (at === -1) throw new Error(`no heading ${JSON.stringify(heading)} in the guide`);

  const rows: string[][] = [];
  let separatorAt = -1;
  for (const line of text.slice(at).split("\n")) {
    const isRow = line.trimStart().startsWith("|");
    if (!isRow) {
      if (rows.length > 0) break; // the table ended
      continue;
    }
    // A dash is what makes it a separator: `| | |` is a wordless HEADER row and
    // matches everything else about the shape, which is how the first version of
    // this read `|---|---|---|` as data.
    if (separatorAt === -1 && line.includes("-") && /^\s*\|[\s|:-]+\|\s*$/.test(line)) {
      separatorAt = rows.length;
      continue;
    }
    rows.push(
      line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
  }
  if (rows.length === 0) throw new Error(`no table under ${JSON.stringify(heading)}`);

  // Everything above the separator is heading, whether or not it has words in it:
  // GeodeMD's guides use both `| key | meaning |` and a wordless `| | |`, and a
  // caller should not have to know which table it is reading.
  return separatorAt === -1 ? rows : rows.slice(separatorAt);
}

/** Strip Markdown emphasis and code ticks from a cell, leaving its text. */
export function plain(cell: string): string {
  return cell.replace(/[`*_]/g, "").trim();
}

/**
 * Every inline-code span in a line or block.
 *
 * Used where a guide names things in prose rather than in a table — the file
 * names it says are recognised as conflict copies, for instance.
 */
export function codeSpans(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);
}

/** The paragraph containing `phrase`, so a test can quote what it is checking. */
export function paragraphWith(text: string, phrase: string): string {
  const para = text.split(/\n\s*\n/).find((p) => p.includes(phrase));
  if (!para) throw new Error(`no paragraph containing ${JSON.stringify(phrase)}`);
  return para;
}
