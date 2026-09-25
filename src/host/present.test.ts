import { describe, expect, it } from "vitest";
import {
  ACTION_KEYS,
  actionsAt,
  deferralReason,
  emptyCounts,
  interpretKey,
  PHASE_LABEL,
  RATING_KEYS,
  ratingBreakdown,
  rescheduledText,
  summaryFields,
} from "./present.js";
import type { SyncSummary } from "../core/index.js";

describe("what a keypress means", () => {
  it("maps 1-4 to ratings", () => {
    expect(interpretKey("1")).toEqual({ kind: "rate", rating: 1 });
    expect(interpretKey("4")).toEqual({ kind: "rate", rating: 4 });
  });

  it("quits on q, Q, Ctrl-C, and escape in both spellings", () => {
    // The terminal's readline reports "escape"; the DOM's KeyboardEvent.key
    // reports "Escape". Both interfaces pass their raw key straight in, so
    // both spellings have to mean the same thing or the GUI silently ignores
    // a key the CLI honours.
    for (const k of ["q", "Q", String.fromCharCode(3), "escape", "Escape"]) {
      expect(interpretKey(k), k).toEqual({ kind: "quit" });
    }
  });

  it("opens the source note on o", () => {
    expect(interpretKey("o")).toEqual({ kind: "open" });
    expect(interpretKey("O")).toEqual({ kind: "open" });
  });

  it("ignores anything else rather than recording a rating nobody chose", () => {
    for (const k of ["5", "9", "x", " ", "Enter", "ArrowDown", ""]) {
      expect(interpretKey(k), k).toEqual({ kind: "ignore" });
    }
  });
});

describe("the shared vocabulary", () => {
  it("names all four FSRS ratings, in order", () => {
    // Spec section 9: the numbers are not guessable, so the words travel with
    // them. Both interfaces read this table rather than writing their own.
    expect(RATING_KEYS.map(([k]) => k)).toEqual(["1", "2", "3", "4"]);
    expect(RATING_KEYS.map(([, l]) => l)).toEqual(["again", "hard", "good", "easy"]);
  });

  it("agrees with interpretKey about every key it advertises", () => {
    // A legend that disagrees with the handler is worse than no legend. The
    // check is that every advertised key DOES something — not what it is
    // called, because the label is a word for the user and the kind is a tag
    // for the code, and tying them together is how `later` would be forced to
    // be called `defer` on screen.
    for (const [key] of RATING_KEYS) {
      expect(interpretKey(key).kind, key).toBe("rate");
    }
    for (const { key } of ACTION_KEYS) {
      expect(interpretKey(key).kind, key).not.toBe("ignore");
    }
  });

  it("offers `later` only at the question and `open` only at the answer", () => {
    // The two are deliberate opposites. `0` means "I am not ready to answer
    // this", which stops being true the moment the answer is showing; `o`
    // needs the answer on screen to be worth offering.
    expect(actionsAt("question").map((a) => a.key)).toEqual(["0", "q"]);
    expect(actionsAt("answer").map((a) => a.key)).toEqual(["o", "q"]);
  });

  it("offers quit at both stages, because a question you cannot leave is a trap", () => {
    for (const stage of ["question", "answer"] as const) {
      expect(actionsAt(stage).some((a) => a.key === "q"), stage).toBe(true);
    }
  });

  it("maps 0 to defer, which records nothing", () => {
    expect(interpretKey("0")).toEqual({ kind: "defer" });
  });
});

describe("which ratings a session summary mentions", () => {
  it("stays quiet about ratings that were never given", () => {
    const counts = { ...emptyCounts(), 3: 5 };
    expect(ratingBreakdown(counts)).toEqual([{ label: "good", count: 5 }]);
  });

  it("reports in rating order, not insertion order", () => {
    const counts = { 1: 2, 2: 0, 3: 1, 4: 7 };
    expect(ratingBreakdown(counts).map((r) => r.label)).toEqual(["again", "good", "easy"]);
  });

  it("is empty for a session with no answers in it", () => {
    expect(ratingBreakdown(emptyCounts())).toEqual([]);
  });
});

const summary = (over: Partial<SyncSummary> = {}): SyncSummary => ({
  filesEnumerated: 10,
  filesUnchanged: 9,
  filesRead: 1,
  filesDeferred: 0,
  filesStamped: 0,
  cardsFound: 3,
  cardsNew: 1,
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
  elapsedMs: 4,
  ...over,
});

const keys = (s: SyncSummary): string[] => summaryFields(s).map((f) => f.key);

describe("which counts a sync summary shows", () => {
  it("always reports the core counts, even at zero", () => {
    // `0 updated` earns its place: it is how you tell a run that found nothing
    // to do from one that did not look.
    expect(keys(summary())).toEqual([
      "filesEnumerated",
      "filesUnchanged",
      "filesRead",
      "cardsFound",
      "cardsNew",
      "cardsUpdated",
    ]);
  });

  it("stays quiet about incidentals at zero", () => {
    expect(keys(summary())).not.toContain("cardsPruned");
    expect(keys(summary())).not.toContain("filesDeferred");
  });

  it("surfaces a skipped file, which the exit code deliberately does not", () => {
    // A skip exits 0 on purpose, so the summary is the ONLY place it appears.
    const fields = summaryFields(summary({ filesSkippedOnError: 2 }));
    expect(fields).toContainEqual({
      key: "filesSkippedOnError",
      label: "files skipped on error",
      value: 2,
    });
  });

  it("puts filesStamped ahead of the other incidentals", () => {
    // On a dry run it is the number being decided on — how many of the user's
    // notes this edits — and `cardsNew` does not answer that.
    const ks = keys(summary({ filesStamped: 3, cardsPruned: 1, reviewsIngested: 5 }));
    expect(ks.indexOf("filesStamped")).toBeLessThan(ks.indexOf("cardsPruned"));
    expect(ks.indexOf("filesStamped")).toBeLessThan(ks.indexOf("reviewsIngested"));
  });

  it("marks unchanged and read as a breakdown of files, and nothing else", () => {
    // The mark is what lets the CLI write `10 files (9 unchanged, 1 read)`
    // without hard-coding the relationship in two places.
    const detail = summaryFields(summary({ cardsPruned: 2 })).filter((f) => f.detail);
    expect(detail.map((f) => f.key)).toEqual(["filesUnchanged", "filesRead"]);
  });

  it("keeps a detail next to the field it breaks down", () => {
    const ks = keys(summary());
    expect(ks[ks.indexOf("filesUnchanged") - 1]).toBe("filesEnumerated");
  });
});

describe("why a freshly-edited file was left alone", () => {
  it("says nothing when nothing was deferred", () => {
    expect(deferralReason(summary())).toBeNull();
  });

  it("explains why, because the counts alone read as a bug", () => {
    const note = deferralReason(summary({ filesDeferred: 1, cardsNew: 0 }))!;
    expect(note).toContain("1 file was");
    expect(note).toContain("in case you have them open");
  });

  it("agrees with itself about plurals", () => {
    expect(deferralReason(summary({ filesDeferred: 2 }))!).toContain("2 files were");
  });

  it("leaves what to do about it to the interface", () => {
    // A terminal would append "run it again"; a window with a Sync button
    // must not say that, which is the whole reason this stops short.
    expect(deferralReason(summary({ filesDeferred: 1 }))!).not.toContain("geode");
  });
});

describe("what each sync phase is called", () => {
  it("names every phase core can report", () => {
    // A missing one renders as `undefined` in a progress bar, which is how a
    // new phase would announce itself.
    expect(Object.keys(PHASE_LABEL).sort()).toEqual(["ingest", "prune", "scan"]);
    for (const label of Object.values(PHASE_LABEL)) expect(label).not.toBe("");
  });
});

describe("what the app says when due dates were worked out again", () => {
  it("says how many, and that the notes and the log were not touched", () => {
    // Due dates moving without a word look like lost reviews (ADR 0028).
    const text = rescheduledText({ cards: 1234 });
    expect(text).toContain("1,234 cards");
    expect(text).toContain("review history");
    expect(text).toContain("Your notes and review log are unchanged");
    expect(rescheduledText({ cards: 1 })).toContain("for 1 card ");
  });
});
