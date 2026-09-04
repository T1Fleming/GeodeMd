#!/usr/bin/env node
/**
 * Spec section 9's command surface. Thin: argv parsing and terminal I/O only.
 * Section 6 rule 1 runs the other way — `core` never imports this.
 *
 * Exit codes (section 8):
 *   0  success, INCLUDING a run that skipped unreadable files — a skip is a
 *      reported outcome, not a failure, and making it non-zero would break
 *      every script the first time one note has bad permissions
 *   1  configuration or usage error
 *   2  unexpected internal error
 */

import { realpathSync } from "node:fs";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Core, ConfigError } from "../core/index.js";
import type { SyncSummary } from "../core/index.js";
import { Store } from "../store/index.js";
import {
  configPath,
  initConfig,
  InitRefused,
  newId,
  readConfig,
} from "./config.js";

const USAGE = `GeodeMD — spaced repetition over a directory of Markdown files

  geode init <path> [--force]   write the config file
  geode sync [--full] [--dry-run]
  geode review [-n N]
  geode stats
  geode rebuild

  --full      re-read every file, ignoring the mtime cache
  --dry-run   report what would change; write nothing
  -n, --limit how many cards to review (default 50)
`;

interface Args {
  command: string | undefined;
  positional: string[];
  flags: Set<string>;
  limit: number | undefined;
}

export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Set<string>();
  let limit: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-n" || a === "--limit") {
      const v = Number(argv[++i]);
      if (Number.isFinite(v) && v > 0) limit = Math.floor(v);
      continue;
    }
    if (a.startsWith("--limit=")) {
      const v = Number(a.slice("--limit=".length));
      if (Number.isFinite(v) && v > 0) limit = Math.floor(v);
      continue;
    }
    if (a.startsWith("-")) {
      flags.add(a.replace(/^-+/, ""));
      continue;
    }
    positional.push(a);
  }
  return { command: positional[0], positional: positional.slice(1), flags, limit };
}

export function formatSummary(s: SyncSummary): string {
  const parts = [
    `${s.filesEnumerated} files (${s.filesUnchanged} unchanged, ${s.filesRead} read)`,
    `${s.cardsFound} cards found`,
    `${s.cardsNew} new`,
    `${s.cardsUpdated} updated`,
  ];
  if (s.cardsPruned) parts.push(`${s.cardsPruned} pruned`);
  if (s.filesDeferred) parts.push(`${s.filesDeferred} deferred`);
  if (s.duplicatesReminted) parts.push(`${s.duplicatesReminted} duplicate ids re-minted`);
  if (s.symlinkedDirsSkipped) parts.push(`${s.symlinkedDirsSkipped} symlinked dirs skipped`);
  if (s.reviewsIngested) parts.push(`${s.reviewsIngested} reviews ingested`);
  if (s.filesSkippedOnError) parts.push(`${s.filesSkippedOnError} files skipped on error`);
  if (s.logLinesSkipped) parts.push(`${s.logLinesSkipped} bad log lines skipped`);
  return `${parts.join(", ")} — ${s.elapsedMs}ms`;
}

/**
 * Explain a deferral, because otherwise it looks like a failure.
 *
 * A file modified in the last couple of seconds is assumed to be open in an
 * editor, so nothing is minted in it (spec section 8 step 4). That is correct,
 * but on a first run — where the note was created moments ago — the summary
 * reads "3 cards found, 0 new" and the user has no idea why. The counts alone
 * do not carry the explanation, so the CLI adds it.
 */
export function deferralNote(s: SyncSummary): string | null {
  if (s.filesDeferred === 0) return null;
  const n = s.filesDeferred;
  const files = n === 1 ? "file was" : "files were";
  return (
    `note: ${n} ${files} modified in the last couple of seconds and left alone, ` +
    `in case you have them open. Run \`geode sync\` again to pick them up.`
  );
}

export const LEGEND = "1 again · 2 hard · 3 good · 4 easy · q quit";

export type KeyAction =
  | { kind: "quit" }
  | { kind: "rate"; rating: 1 | 2 | 3 | 4 }
  | { kind: "ignore" };

/** Ctrl-C as it arrives from a raw-mode keypress. */
const ETX = String.fromCharCode(3);

/**
 * What a keypress means at the rating prompt. Pure, so the loop's decisions are
 * testable without a pseudo-terminal — the loop itself is deliberately thin.
 */
export function interpretKey(key: string): KeyAction {
  if (key === "q" || key === "Q" || key === ETX || key === "escape") return { kind: "quit" };
  if (key >= "1" && key <= "4") return { kind: "rate", rating: Number(key) as 1 | 2 | 3 | 4 };
  return { kind: "ignore" };
}

async function openCore(): Promise<{ core: Core; store: Store }> {
  const file = configPath();
  const config = await readConfig(file);
  if (!config) {
    throw new ConfigError(`no config at ${file} — run \`geode init <path>\` first`);
  }
  const store = new Store(config.dbPath);
  const core = new Core({ ...config, newId }, store);
  return { core, store };
}

/** Section 9's review loop. Requires a TTY; restores the terminal on any exit. */
async function reviewLoop(core: Core, limit: number): Promise<void> {
  if (!process.stdin.isTTY) {
    // A line-buffered fallback that half works is worse than a clear refusal,
    // and there is no use for scripted review.
    throw new ConfigError("review requires an interactive terminal");
  }

  await core.ingestLogs(new Date());
  const now = new Date();
  const queue = core.getDueCards(now, limit);
  const total = core.countDue(now);

  if (queue.length === 0) {
    process.stdout.write("Nothing due.\n");
    return;
  }
  process.stdout.write(`${queue.length} of ${total} due\n\n`);

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
  };
  // A process that dies in raw mode leaves echo off, which reads as a broken
  // shell rather than as a quit. Every rating already given is safe by the
  // log-first rule, so a clean exit is honest.
  const onSigint = (): void => {
    restore();
    process.stdout.write("\n");
    process.exit(0);
  };
  process.on("SIGINT", onSigint);

  const key = async (): Promise<string> =>
    new Promise((resolve) => {
      const handler = (str: string, k: { name?: string; ctrl?: boolean }): void => {
        process.stdin.off("keypress", handler);
        if (k?.ctrl && k.name === "c") resolve("q");
        else resolve(str ?? k?.name ?? "");
      };
      process.stdin.on("keypress", handler);
    });

  try {
    let done = 0;
    for (const card of queue) {
      process.stdout.write(`${card.question}\n`);
      process.stdout.write(`  ${card.locator}\n`);
      await key();
      process.stdout.write(`\n  ${card.answer}\n\n  ${LEGEND}\n`);

      let rating: 1 | 2 | 3 | 4 | null = null;
      while (rating === null) {
        const action = interpretKey(await key());
        if (action.kind === "quit") {
          process.stdout.write(`\n${done} reviewed.\n`);
          return;
        }
        if (action.kind === "rate") rating = action.rating;
      }

      try {
        await core.reviewCard(card.id, rating, new Date());
      } catch (err) {
        // WAL allows one writer. By now the rating is already fsynced into the
        // log, so this is precisely the condition the next ingest repairs.
        if (isBusy(err)) {
          process.stdout.write("  database busy; reviews are in the log and will sync later\n");
        } else {
          throw err;
        }
      }
      done++;
      process.stdout.write("\n");
    }
    process.stdout.write(`${done} reviewed.\n`);
  } finally {
    process.off("SIGINT", onSigint);
    restore();
  }
}

function isBusy(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    String((err as { code: unknown }).code).startsWith("SQLITE_BUSY")
  );
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (!args.command || args.flags.has("h") || args.flags.has("help")) {
    process.stdout.write(USAGE);
    return args.command ? 0 : 1;
  }

  switch (args.command) {
    case "init": {
      const target = args.positional[0];
      if (!target) {
        process.stderr.write("usage: geode init <path> [--force]\n");
        return 1;
      }
      const file = configPath();
      const config = await initConfig(file, target, { force: args.flags.has("force") });
      process.stdout.write(`wrote ${file}\n`);
      process.stdout.write(`  notes:  ${config.notesPath}\n`);
      process.stdout.write(`  device: ${config.device}\n`);
      process.stdout.write(`  db:     ${config.dbPath}\n\n`);
      // The first real sync stamps every file holding a card — much better
      // learned from a dry run than from a diff.
      process.stdout.write("Next: commit your notes if they are in version control,\n");
      process.stdout.write("then run `geode sync --dry-run` to see what would change.\n");
      return 0;
    }

    case "sync":
    case "rebuild": {
      const { core, store } = await openCore();
      try {
        const opts = {
          full: args.flags.has("full"),
          dryRun: args.flags.has("dry-run") || args.flags.has("dryrun"),
        };
        const summary =
          args.command === "rebuild"
            ? await core.rebuild(new Date(), opts)
            : await core.sync(new Date(), opts);
        if (opts.dryRun) process.stdout.write("dry run — nothing was written\n");
        process.stdout.write(`${formatSummary(summary)}\n`);
        const note = deferralNote(summary);
        if (note) process.stdout.write(`${note}\n`);
        return 0;
      } finally {
        store.close();
      }
    }

    case "review": {
      const { core, store } = await openCore();
      try {
        await reviewLoop(core, args.limit ?? 50);
        return 0;
      } finally {
        store.close();
      }
    }

    case "stats": {
      const { core, store } = await openCore();
      try {
        await core.ingestLogs(new Date());
        const s = core.stats(new Date());
        process.stdout.write(`total:                ${s.total}\n`);
        process.stdout.write(`due now:              ${s.dueNow}\n`);
        process.stdout.write(`due before midnight:  ${s.dueBeforeMidnight}\n`);
        process.stdout.write(`new:                  ${s.newCards}\n`);
        return 0;
      } finally {
        store.close();
      }
    }

    default:
      process.stderr.write(`unknown command: ${args.command}\n\n${USAGE}`);
      return 1;
  }
}

/**
 * Is this module the process entry point?
 *
 * `process.argv[1]` is whatever path invoked us, which under `npm link` is a
 * symlink in a bin directory, while `import.meta.url` is always the resolved
 * file. Comparing them directly makes the installed binary a no-op — it exits 0
 * having done nothing — so both sides are resolved before comparing.
 */
export function isEntryPoint(metaUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

const isEntry = isEntryPoint(import.meta.url, process.argv[1]);

if (isEntry) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      if (err instanceof ConfigError || err instanceof InitRefused) {
        process.stderr.write(`${err.message}\n`);
        process.exit(1);
      }
      process.stderr.write(`unexpected error: ${String(err)}\n`);
      process.exit(2);
    });
}
