/**
 * What part of GeodeMD each group of tests describes.
 *
 * The suite is organised by **module**, which is right — a test next to the code
 * it covers is what keeps the boundary rules legible. But it means one
 * user-facing behaviour is scattered: `0 later` is asserted in six files, and
 * "what does `0` do?" has no single place to look. This table is the assembly
 * step, and `reporter.ts` uses it to write `docs/design/behaviours.md`.
 *
 * **The areas follow the guides, not the source tree.** Reviewing, syncing,
 * recovery and moving between machines are the four things `docs/guides/`
 * describes, so a reader who wants to know what the app does can start from the
 * same four words in either place. The last few areas are the project's own
 * concerns rather than a user's, and they are last for that reason.
 *
 * Two levels, because one is not enough: a file usually belongs to one area, and
 * a few genuinely straddle two — `host/present.ts` owns both the review keys and
 * the wording of a sync summary, and its tests follow it. So the default is per
 * file and the exception is per group, rather than pretending either alone is
 * true. `areas.test.ts` fails when a group is unclassified, which is what keeps
 * this honest as tests are added.
 */

export interface Area {
  name: string;
  /** One line, printed under the heading. Says what the area is for. */
  blurb: string;
}

/** In the order they appear in the document: what a user does, then internals. */
export const AREAS: readonly Area[] = [
  {
    name: "Reviewing",
    blurb:
      "A session: which card is next, what the keys mean, what a rating records, " +
      "and what comes back before the sitting ends.",
  },
  {
    name: "Recognising a card",
    blurb:
      "Text in, cards out. Also — and mostly — the shapes that are deliberately " +
      "NOT cards, because a false positive writes a stamp into someone's note.",
  },
  {
    name: "Syncing notes",
    blurb: "Finding what changed, stamping it, pruning what is gone, and saying what happened.",
  },
  {
    name: "Recovery and the log",
    blurb:
      "The append-only review log, and rebuilding the database from nothing but " +
      "notes and logs.",
  },
  {
    name: "Moving between machines",
    blurb: "One notes directory, two devices, no built-in sync transport.",
  },
  {
    name: "Setting up this machine",
    blurb: "Config, XDG paths, the device name, and the first run.",
  },
  {
    name: "The app's long runs",
    blurb: "Single-flight, progress, and how a window that missed an event catches up.",
  },
  {
    name: "The terminal",
    blurb: "Argument parsing, colour, and wrapping — the parts that are the CLI's alone.",
  },
  {
    name: "The database as a cache",
    blurb: "Schema decisions the rest of the system leans on, and what they cost.",
  },
  { name: "At scale", blurb: "The properties that must hold at a million cards." },
  {
    name: "Rules the project enforces on itself",
    blurb:
      "Module boundaries, and the completeness of this document — both checked by " +
      "scanning source text rather than trusted.",
  },
  {
    name: "The documentation tells the truth",
    blurb: "Documents that make checkable claims, checked.",
  },
];

/** The area a test file belongs to unless one of its groups says otherwise. */
export const BY_FILE: Readonly<Record<string, string>> = {
  "parser/parser.test.ts": "Recognising a card",

  "core/review.test.ts": "Reviewing",
  "core/busy.test.ts": "Reviewing",
  "host/queue.test.ts": "Reviewing",
  "host/present.test.ts": "Reviewing",
  "host/editor.test.ts": "Reviewing",
  "cli/render.test.ts": "Reviewing",
  "electron/renderer/model/session.test.ts": "Reviewing",
  "electron/main/open.test.ts": "Reviewing",

  "core/sync.test.ts": "Syncing notes",
  "files/files.test.ts": "Syncing notes",

  "core/rebuild.test.ts": "Recovery and the log",
  "core/two-devices.test.ts": "Moving between machines",

  "host/host.test.ts": "Setting up this machine",
  "host/setup.test.ts": "Setting up this machine",
  "electron/renderer/model/setup.test.ts": "Setting up this machine",

  "electron/main/runs.test.ts": "The app's long runs",
  "electron/renderer/model/run.test.ts": "The app's long runs",

  "cli/cli.test.ts": "The terminal",
  "cli/style.test.ts": "The terminal",

  "store/store.test.ts": "The database as a cache",

  "core/scale.test.ts": "At scale",
  "files/enumerate.bench.test.ts": "At scale",

  "boundaries.test.ts": "Rules the project enforces on itself",
  "behaviours/areas.test.ts": "Rules the project enforces on itself",
  "demo.test.ts": "The documentation tells the truth",
};

/**
 * Groups that belong somewhere other than their file's area.
 *
 * Keyed `<file>:<top-level describe>`. Each one of these is a module that does
 * two jobs on purpose: `host/present.ts` is the shared vocabulary for *both*
 * the review keys and a sync summary's wording, and `files/index.ts` owns both
 * the notes tree and the review log. Filing their tests by module would put
 * sync reporting under "Reviewing", which is how a taxonomy stops being read.
 */
export const BY_GROUP: Readonly<Record<string, string>> = {
  "host/present.test.ts:summaryFields": "Syncing notes",
  "host/present.test.ts:deferralReason": "Syncing notes",
  "host/present.test.ts:PHASE_LABEL": "Syncing notes",

  "files/files.test.ts:the review log": "Recovery and the log",
  "files/files.test.ts:readShardFrom": "Recovery and the log",

  "cli/cli.test.ts:formatSummary": "Syncing notes",
  "cli/cli.test.ts:deferralNote": "Syncing notes",
  "cli/cli.test.ts:interpretKey": "Reviewing",
};

/**
 * Which area a group belongs to, or null when nothing says.
 *
 * Null rather than a default area, because a silent fallback is how the
 * unclassified group nobody noticed ends up filed under whatever came first.
 * `areas.test.ts` turns the null into a failure.
 */
export function areaFor(file: string, group: string): string | null {
  return BY_GROUP[`${file}:${group}`] ?? BY_FILE[file] ?? null;
}
