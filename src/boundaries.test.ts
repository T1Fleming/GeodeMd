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

/**
 * Recursive, and `.tsx` as well as `.ts`.
 *
 * Both matter more than they look. A one-level `readdir` returns nothing for a
 * module that keeps its files in subdirectories — so every rule below would
 * PASS while scanning no files at all, which is worse than having no rule. A
 * renderer will be `.tsx`, and skipping that extension has the same effect.
 * Neither is exercised today; both become load-bearing the moment a module
 * with subdirectories exists.
 */
async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(abs: string): Promise<void> {
    for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
      const child = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
      out.push(child);
    }
  }

  await walk(path.join(SRC, dir));
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

/**
 * Matches an import of a sibling module by directory name.
 *
 * The trailing slash is load-bearing. Written as `[^"']*\/cli` it also matches
 * `react-dom/client` — `cli` is a prefix of `client` — and the rule fires on an
 * innocent dependency while looking like a real violation. A boundary test that
 * cries wolf gets weakened, which is worse than not having it.
 */
const importsModule = (name: string): RegExp =>
  new RegExp(`from\\s+["'][^"']*\\/${name}\\/`);

/** One file, for rules that are about a specific file rather than a module. */
async function readFile(rel: string): Promise<string> {
  return stripComments(await fs.readFile(path.join(SRC, rel), "utf8"));
}

async function readAll(dir: string): Promise<string> {
  const files = await sourceFiles(dir);
  const texts = await Promise.all(files.map((f) => fs.readFile(f, "utf8")));
  return stripComments(texts.join("\n"));
}

describe("section 6 hard rules", () => {
  it("rule 1: core never imports cli", async () => {
    expect(await readAll("core")).not.toMatch(importsModule("cli"));
  });

  it("rule 1: no module below cli imports cli", async () => {
    for (const dir of ["core", "store", "files", "parser", "scheduler", "host"]) {
      expect(await readAll(dir), `${dir} imports cli`).not.toMatch(importsModule("cli"));
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
    for (const dir of ["core", "files", "parser", "scheduler", "cli", "host"]) {
      expect(await readAll(dir), `${dir} imports better-sqlite3`).not.toMatch(
        /from\s+["']better-sqlite3["']/,
      );
    }
    expect(await readAll("store")).toMatch(/from\s+["']better-sqlite3["']/);
  });

  it("only store/ writes SQL", async () => {
    for (const dir of ["core", "files", "parser", "scheduler", "host"]) {
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

/**
 * ADR 0013: the CLI and the Electron app are peers over one `core`, forever.
 * `host` is what they share — the code that knows about this machine. These
 * rules are what stop "shared" from quietly becoming "whatever cli exported".
 */
describe("host, shared by both interfaces", () => {
  it("never writes to the terminal", async () => {
    // The distinction from `core`: host MAY read process.env — that is its
    // whole job. What it may not do is assume a terminal is listening.
    const host = await readAll("host");
    expect(host).not.toMatch(/console\.(log|error|warn)/);
    expect(host).not.toMatch(/process\.(exit|stdout|stderr)/);
  });

  it("is where ambient machine state is read, so core does not have to", async () => {
    const host = await readAll("host");
    expect(host).toMatch(/process\.env/);
    expect(host).toMatch(/os\.homedir|os\.hostname/);
  });

  it("owns the review vocabulary, so the two interfaces cannot disagree", async () => {
    // What a key MEANS and what a rating is CALLED are shared; drawing them is
    // not. If either interface grew its own table, the two would drift and
    // each would stay self-consistent — a usability bug no test would catch.
    const host = await readAll("host");
    expect(host).toMatch(/RATING_KEYS/);
    expect(host).toMatch(/interpretKey/);

    for (const dir of ["cli", "electron"]) {
      expect(await readAll(dir), `${dir} defines its own rating table`).not.toMatch(
        /\["1",\s*"again"\]/,
      );
    }
  });

  it("owns which program opens a note, and how it is told a line", async () => {
    // Same argument as the rating table above, and the same failure mode: two
    // editor tables would each stay self-consistent while `o` landed on line 1
    // in one interface and line 142 in the other. `--goto` is the marker —
    // it is the VS Code family's line flag and appears nowhere else.
    const host = await readAll("host");
    expect(host).toMatch(/resolveEditor/);
    expect(host).toMatch(/--goto/);

    for (const dir of ["cli", "electron"]) {
      expect(await readAll(dir), `${dir} has its own editor table`).not.toMatch(/--goto/);
    }
  });

  it("owns what a sync summary says, so the two cannot report differently", async () => {
    // WHICH counts are worth showing is one question with one answer; joining
    // them with commas or laying them out as a grid is not. The markers are
    // two labels that appear nowhere else: a phase name and an incidental
    // count. Either one turning up in an interface means the list was copied.
    const host = await readAll("host");
    expect(host).toMatch(/summaryFields/);
    expect(host).toMatch(/reading review history/);
    expect(host).toMatch(/duplicate ids re-minted/);

    for (const dir of ["cli", "electron"]) {
      expect(await readAll(dir), `${dir} restates the summary list`).not.toMatch(
        /duplicate ids re-minted/,
      );
      expect(await readAll(dir), `${dir} names the phases itself`).not.toMatch(
        /reading review history/,
      );
    }
  });

  it("leaves the spawn to each interface, because the two are not the same", async () => {
    // The pure half is shared; the spawn is NOT, and this is the one place the
    // distinction is visible. `stdio: "inherit"` hands over the TTY and is
    // right for vim; a GUI has no TTY and must detach. host does neither — it
    // spawns nothing at all, which is what keeps it usable from both.
    expect(await readAll("host")).not.toMatch(/from\s+["']node:child_process["']/);
    expect(await readAll("cli")).toMatch(/stdio:\s*"inherit"/);
    expect(await readAll("electron")).toMatch(/detached:\s*true/);
  });

  it("core does not import host either — it takes its config as an argument", async () => {
    // Rule 3 the other way round. host reads ambient state; if core could
    // import it, core could reach that state through the back door.
    for (const dir of ["core", "store", "files", "parser", "scheduler"]) {
      expect(await readAll(dir), `${dir} imports host`).not.toMatch(importsModule("host"));
    }
  });
});

/**
 * ADR 0013 again: two peers, one core. A peer that reaches into the other is
 * no longer a peer, and the drift starts the day one of them needs "just one"
 * helper from the other.
 */
describe("electron, the second interface", () => {
  it("does not import cli, and cli does not import it", async () => {
    expect(await readAll("electron"), "electron imports cli").not.toMatch(importsModule("cli"));
    expect(await readAll("cli"), "cli imports electron").not.toMatch(importsModule("electron"));
  });

  it("nothing below the interfaces imports electron", async () => {
    for (const dir of ["core", "store", "files", "parser", "scheduler", "host"]) {
      expect(await readAll(dir), `${dir} imports electron`).not.toMatch(
        importsModule("electron"),
      );
    }
  });

  it("keeps onProgress out of the wire types", async () => {
    // protocol.ts is the command/reply shape. ADR 0017 keeps core in the main
    // process for now, so nothing literally crosses a port today — but this is
    // the contract that lets it move later, and a callback in it is what would
    // quietly make that move impossible. `onProgress` is the specific hazard:
    // it is a function on an options object that otherwise looks like data.
    //
    // Deliberately one concrete name rather than a clever regex for "any
    // function type". A pattern broad enough to catch every shape is also
    // broad enough to pass for the wrong reason, which is the failure mode
    // this file exists to avoid.
    //
    // Scoped to ipc.ts, not the whole directory: main-process code legitimately
    // ATTACHES an onProgress callback — that is how progress is collected at
    // all. The rule is about what crosses, not about who may mention it.
    expect(await readFile("electron/ipc.ts")).not.toMatch(/onProgress/);
  });
});
