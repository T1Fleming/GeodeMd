import { describe, expect, it } from "vitest";
import {
  back,
  begin,
  blockers,
  canAdvance,
  canSync,
  next,
  picked,
  previewReport,
  previewed,
  proposed,
  setAcknowledged,
  setReplace,
} from "./setup.js";
import type { Setup } from "./setup.js";
import type { AppConfig, ConfigProposal, FolderReport, SyncSummary } from "../../ipc.js";

const folder = (over: Partial<FolderReport> = {}): FolderReport => ({
  path: "/notes",
  exists: true,
  isDirectory: true,
  markdownFiles: 23,
  isGitRepo: true,
  symlinkedDirs: 0,
  ...over,
});

const proposal = (over: Partial<ConfigProposal> = {}): ConfigProposal => ({
  notesPath: "/notes",
  device: "laptop-ab12",
  dbPath: "/data/db.sqlite",
  replaces: null,
  preserved: [],
  ...over,
});

/** A config already on disk, which is what makes keep-or-replace a question. */
const existing = (over: Partial<AppConfig> = {}): AppConfig => ({
  notesPath: "/old/notes",
  device: "laptop-ab12",
  dbPath: "/data/db.sqlite",
  ...over,
});

const summary = (over: Partial<SyncSummary> = {}): SyncSummary => ({
  filesEnumerated: 5,
  filesUnchanged: 0,
  filesRead: 5,
  filesDeferred: 0,
  filesStamped: 3,
  cardsFound: 23,
  cardsNew: 23,
  cardsUpdated: 0,
  cardsPruned: 0,
  reconciled: false,
  duplicatesReminted: 0,
  symlinkedDirsSkipped: 0,
  logShardsSkipped: 0,
  logBytesRead: 0,
  reviewsIngested: 0,
  filesSkippedOnError: 0,
  logLinesSkipped: 0,
  elapsedMs: 9,
  ...over,
});

/** Walk to a step the way the screen does, so the guards are exercised. */
function at(step: Setup["step"], over: Partial<Setup> = {}): Setup {
  let s = picked(begin(), folder());
  s = proposed(s, proposal());
  s = setAcknowledged(s, true);
  s = { ...s, step, ...over };
  return s;
}

describe("choosing a folder", () => {
  it("will not move on until one is chosen", () => {
    expect(canAdvance(begin())).toBe(false);
    expect(blockers(begin())[0]).toContain("Choose the folder");
  });

  it("accepts an empty folder, because starting from nothing is legitimate", () => {
    // The count is a signal to show, not a gate. Refusing here would block the
    // most obvious way to start using the tool at all.
    const s = picked(begin(), folder({ markdownFiles: 0 }));
    expect(canAdvance(s)).toBe(true);
  });

  it("refuses a path that is not a directory", () => {
    expect(canAdvance(picked(begin(), folder({ isDirectory: false })))).toBe(false);
    expect(canAdvance(picked(begin(), folder({ exists: false })))).toBe(false);
  });

  it("lands on the confirm step", () => {
    expect(picked(begin(), folder()).step).toBe("confirm");
  });
});

describe("an existing config", () => {
  it("makes using the new folder an explicit choice", () => {
    const s = at("config", { proposal: proposal({ replaces: existing() }) });
    expect(canAdvance(s)).toBe(false);
    expect(blockers(s)[0]).toContain("the new folder");
    expect(canAdvance(setReplace(s, true))).toBe(true);
  });

  it("treats keeping the old settings as a way out, not a way forward", () => {
    // Continuing would write the NEW path, which is the opposite of what
    // "keep those" asked for. The screen handles it by leaving the sequence.
    const s = setReplace(at("config", { proposal: proposal({ replaces: existing() }) }), false);
    expect(canAdvance(s)).toBe(false);
  });

  it("is not asked at all on a first run", () => {
    expect(canAdvance(at("config"))).toBe(true);
  });

  it("re-opens the question when a different config is proposed", () => {
    // An answer about one config must not carry over to another.
    let s = at("config", { proposal: proposal({ replaces: existing() }) });
    s = setReplace(s, true);
    s = proposed(s, proposal({ replaces: existing() }));
    expect(s.replace).toBeNull();
    expect(canAdvance(s)).toBe(false);
  });
});

describe("the acknowledgement", () => {
  it("is required exactly once, and blocks nothing else", () => {
    // This is the irreversible-step gate the user actually reads: the first
    // sync writes into every note holding a card.
    const s = at("vcs", { acknowledged: false });
    expect(canAdvance(s)).toBe(false);
    expect(canAdvance(setAcknowledged(s, true))).toBe(true);
    // Not a blocker on any earlier step.
    expect(canAdvance(at("confirm", { acknowledged: false }))).toBe(true);
  });
});

describe("the preview gate", () => {
  it("is what makes the real sync reachable at all", () => {
    const s = at("preview");
    expect(canSync(s)).toBe(false);
    expect(blockers(s)[0]).toContain("Run the preview first");
    expect(canSync(previewed(s, summary()))).toBe(true);
  });

  it("is cleared by choosing a different folder", () => {
    // THE bug this model exists for: preview folder A, go back, pick folder B,
    // and without this the real sync runs against B on A's numbers.
    let s = previewed(at("preview"), summary());
    expect(canSync(s)).toBe(true);
    s = picked(s, folder({ path: "/somewhere-else" }));
    expect(canSync(s)).toBe(false);
    expect(s.proposal).toBeNull();
  });

  it("survives stepping back and forward over the same folder", () => {
    // Re-confirming the same choice should not cost the user a second preview;
    // only actually changing the folder does.
    const s = previewed(at("preview"), summary());
    expect(canSync(next(back(s)))).toBe(true);
  });
});

describe("walking the steps", () => {
  it("does not advance past a blocker", () => {
    const stuck = at("vcs", { acknowledged: false });
    expect(next(stuck)).toBe(stuck);
  });

  it("goes forward and back through every step in order", () => {
    let s = at("confirm");
    for (const step of ["config", "vcs", "preview"]) {
      s = next(s);
      expect(s.step).toBe(step);
    }
    // And `preview` is the last one — the real sync is an action, not a step.
    expect(next(s).step).toBe("preview");
    for (const step of ["vcs", "config", "confirm", "welcome"]) {
      s = back(s);
      expect(s.step).toBe(step);
    }
    expect(back(s).step).toBe("welcome");
  });
});

describe("what the preview says would change", () => {
  it("reports notes edited from filesStamped, not from cardsNew", () => {
    // One file can hold fifty cards. `cardsNew` does not answer "how many of
    // my notes does this rewrite", which is the question being asked here.
    const r = previewReport(summary({ filesStamped: 3, cardsNew: 23 }));
    expect(r.notesEdited).toBe(3);
    expect(r.cardsFound).toBe(23);
    expect(r.filesRead).toBe(5);
  });
});
