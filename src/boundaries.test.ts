import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Spec section 6's five hard rules, enforced rather than trusted.
 *
 * "If those five hold, the Electron app is `core` plus a renderer. If they
 * don't, it's a rewrite." They are cheap to check and expensive to rediscover,
 * so they are a test.
 */

const SRC = path.dirname(fileURLToPath(import.meta.url));

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(SRC, dir), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    out.push(path.join(SRC, dir, entry.name));
  }
  return out;
}

/**
 * Comments are stripped before checking. These modules *document* the rules
 * they obey — `core` says "never console.log", `store` explains why fsync lives
 * elsewhere — and a checker that reads prose would fail on the documentation
 * rather than on a violation.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

async function readAll(dir: string): Promise<string> {
  const files = await sourceFiles(dir);
  const texts = await Promise.all(files.map((f) => fs.readFile(f, "utf8")));
  return stripComments(texts.join("\n"));
}

describe("section 6 hard rules", () => {
  it("rule 1: core never imports cli", async () => {
    expect(await readAll("core")).not.toMatch(/from\s+["'][^"']*cli/);
  });

  it("rule 1: no module below cli imports cli", async () => {
    for (const dir of ["core", "store", "files", "parser", "scheduler"]) {
      expect(await readAll(dir), `${dir} imports cli`).not.toMatch(/from\s+["'][^"']*\/cli/);
    }
  });

  it("rule 2: core never writes to the terminal, exits, or prompts", async () => {
    const core = await readAll("core");
    expect(core).not.toMatch(/console\.(log|error|warn)/);
    expect(core).not.toMatch(/process\.(exit|stdout|stderr)/);
  });

  it("rule 3: core reads no ambient config", async () => {
    expect(await readAll("core")).not.toMatch(/process\.env/);
  });

  it("rule 4: parser opens no file", async () => {
    const parser = await readAll("parser");
    expect(parser).not.toMatch(/from\s+["']node:fs/);
    expect(parser).not.toMatch(/require\(["']fs/);
  });

  it("parser touches no database and no clock", async () => {
    const parser = await readAll("parser");
    expect(parser).not.toMatch(/better-sqlite3/);
    expect(parser).not.toMatch(/new Date\(|Date\.now/);
  });
});

describe("one module per external resource", () => {
  it("only store/ imports better-sqlite3", async () => {
    for (const dir of ["core", "files", "parser", "scheduler", "cli"]) {
      expect(await readAll(dir), `${dir} imports better-sqlite3`).not.toMatch(
        /from\s+["']better-sqlite3["']/,
      );
    }
    expect(await readAll("store")).toMatch(/from\s+["']better-sqlite3["']/);
  });

  it("only store/ writes SQL", async () => {
    for (const dir of ["core", "files", "parser", "scheduler"]) {
      expect(await readAll(dir), `${dir} contains SQL`).not.toMatch(
        /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE)\b/,
      );
    }
  });

  it("the log lives under files/, not store/", async () => {
    // Filing it under store/ is tempting because it holds review history, but
    // that would put fsync and O_APPEND in the module whose only job is SQLite.
    expect(await readAll("files")).toMatch(/fsyncSync/);
    expect(await readAll("store")).not.toMatch(/fsync|O_APPEND/);
  });

  it("scheduler pins its parameters rather than inheriting them", async () => {
    const scheduler = await readAll("scheduler");
    expect(scheduler).toMatch(/enable_fuzz:\s*false/);
    expect(scheduler).toMatch(/request_retention:/);
    expect(scheduler).toMatch(/maximum_interval:/);
    // The weight vector is written out literally, so a ts-fsrs bump cannot
    // silently change what a rebuild produces from an unchanged log.
    expect(scheduler).toMatch(/w:\s*\[/);
  });
});
