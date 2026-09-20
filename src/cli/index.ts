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
import { stat } from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Core, ConfigError } from "../core/index.js";
import type { DueCard, SyncSummary } from "../core/index.js";
import { Store } from "../store/index.js";
import {
  configPath,
  initConfig,
  InitRefused,
  newId,
  ensureConfig,
} from "./config.js";
import type { FileConfig } from "./config.js";
import { openInEditor, resolveEditor } from "./editor.js";
import {
  emptyCounts,
  renderAnswer,
  renderHeader,
  renderNote,
  renderPrompt,
  renderStaleNote,
  renderSummary,
} from "./render.js";
import { colorEnabled, columns, styler } from "./style.js";

export { LEGEND } from "./render.js";

const USAGE = `GeodeMD — spaced repetition over a directory of Markdown files

  geode init <path> [--force]   write the config file
  geode sync [--full] [--dry-run]
  geode review [-n N]           any key flips a card; o opens its note
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

export type KeyAction =
  | { kind: "quit" }
  | { kind: "rate"; rating: 1 | 2 | 3 | 4 }
  | { kind: "open" }
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
  if (key === "o" || key === "O") return { kind: "open" };
  return { kind: "ignore" };
}

async function openCore(): Promise<{ core: Core; store: Store; config: FileConfig }> {
  const file = configPath();
  // `ensureConfig`, not `readConfig`: everything reached through here can write
  // a review log, and a config with no `device` would otherwise hand out a
  // fresh name on every read.
  const config = await ensureConfig(file);
  if (!config) {
    throw new ConfigError(`no config at ${file} — run \`geode init <path>\` first`);
  }
  const store = new Store(config.dbPath);
  // Named fields rather than a spread: `editor` is the CLI's business and has
  // no place in core's Config.
  const core = new Core(
    { notesPath: config.notesPath, device: config.device, dbPath: config.dbPath, newId },
    store,
  );
  return { core, store, config };
}

/** Null when the file cannot be read — an unreadable note is not an error here. */
async function mtimeOf(file: string): Promise<number | null> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/** Section 9's review loop. Requires a TTY; restores the terminal on any exit. */
async function reviewLoop(core: Core, config: FileConfig, limit: number): Promise<void> {
  if (!process.stdin.isTTY) {
    // A line-buffered fallback that half works is worse than a clear refusal,
    // and there is no use for scripted review.
    throw new ConfigError("review requires an interactive terminal");
  }

  await core.ingestLogs(new Date());
  const now = new Date();
  const queue = core.getDueCards(now, limit);
  // What the queue was drawn FROM, which is both halves of section 9's two
  // queries. `countDue` alone counts only cards with scheduling state, so a
  // first session — every card new — headed itself "2 of 0 due".
  const available = core.stats(now);
  const total = available.dueNow + available.newCards;

  const s = styler(colorEnabled(process.env, Boolean(process.stdout.isTTY)));
  const width = columns(process.stdout);

  if (queue.length === 0) {
    process.stdout.write(`\n${renderNote("Nothing due.", s)}`);
    return;
  }
  process.stdout.write(renderHeader(queue.length, total, s));

  readline.emitKeypressEvents(process.stdin);
  const setRaw = (on: boolean): void => {
    if (process.stdin.isTTY) process.stdin.setRawMode(on);
    if (on) process.stdin.resume();
    else process.stdin.pause();
  };
  setRaw(true);

  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    setRaw(false);
  };
  // A process that dies in raw mode leaves echo off, which reads as a broken
  // shell rather than as a quit. Every rating already given is safe by the
  // log-first rule, so a clean exit is honest.
  //
  // While an editor holds the terminal, though, a Ctrl-C is aimed at *it*:
  // stdio is inherited, so the signal reaches this process as well, and acting
  // on it would end the session out from under the editor.
  let editorRunning = false;
  const onSigint = (): void => {
    if (editorRunning) return;
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

  /**
   * Notes opened this session, against the mtime each had when it was first
   * opened. Checked once at the end rather than when the editor exits: a
   * terminal editor holds the terminal until you quit it, but `code`, `subl`,
   * `zed` and every OS opener hand the file to a running instance and return in
   * milliseconds — long before anything has been typed. Comparing around the
   * spawn would therefore report nothing in exactly the setup where the user is
   * most likely to keep editing while the session runs.
   */
  const openedNotes = new Map<string, number | null>();

  /** Open the note this card was written in, then hand the terminal back. */
  const openContext = async (card: DueCard): Promise<string | null> => {
    const abs = path.join(config.notesPath, card.filePath);
    if (!openedNotes.has(card.filePath)) openedNotes.set(card.filePath, await mtimeOf(abs));
    const editor = resolveEditor(config.editor, process.env);

    editorRunning = true;
    setRaw(false);
    try {
      return await openInEditor(abs, card.lineNo, editor);
    } finally {
      setRaw(true);
      editorRunning = false;
    }
  };

  const counts = emptyCounts();

  /**
   * Every exit path ends here. Editing a card would otherwise leave the
   * database quietly holding the old text until the next sync, with no sign
   * that it had.
   */
  const sessionEnd = async (): Promise<string> => {
    const changed: string[] = [];
    for (const [rel, before] of openedNotes) {
      // `!==` covers a note that was created or removed while it was open, not
      // only one that was rewritten; two unreadable reads compare equal and are
      // correctly not a change.
      if ((await mtimeOf(path.join(config.notesPath, rel))) !== before) changed.push(rel);
    }
    // Summary first: it carries the blank line that separates the session from
    // the last card, and the note that wants acting on then sits last, where
    // the eye lands.
    return renderSummary(counts, s) + renderStaleNote(changed, s);
  };

  try {
    let index = 0;
    for (const card of queue) {
      index++;
      const prompt = renderPrompt(card, index, queue.length, s, width);
      const answer = renderAnswer(card, s, width);

      process.stdout.write(prompt);
      // Any key flips, but `q` still quits: a question you cannot escape from
      // without answering it is not what the legend promises.
      if (interpretKey(await key()).kind === "quit") {
        process.stdout.write(await sessionEnd());
        return;
      }
      process.stdout.write(answer);

      let rating: 1 | 2 | 3 | 4 | null = null;
      while (rating === null) {
        const action = interpretKey(await key());
        if (action.kind === "quit") {
          process.stdout.write(await sessionEnd());
          return;
        }
        if (action.kind === "open") {
          const failure = await openContext(card);
          // A terminal editor has scribbled over the card. Put it back, so the
          // rating is given against something still on screen — and put any
          // complaint about the editor *after* it, where the cursor is, rather
          // than above a full card render where it scrolls out of the eye.
          process.stdout.write(prompt);
          process.stdout.write(answer);
          if (failure !== null) process.stdout.write(renderNote(failure, s));
          continue;
        }
        if (action.kind === "rate") rating = action.rating;
      }

      try {
        await core.reviewCard(card.id, rating, new Date());
      } catch (err) {
        // WAL allows one writer. By now the rating is already fsynced into the
        // log, so this is precisely the condition the next ingest repairs.
        if (isBusy(err)) {
          process.stdout.write(
            renderNote("database busy; reviews are in the log and will sync later", s),
          );
        } else {
          throw err;
        }
      }
      counts[rating]++;
    }
    process.stdout.write(await sessionEnd());
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
      const { core, store, config } = await openCore();
      try {
        await reviewLoop(core, config, args.limit ?? 50);
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
