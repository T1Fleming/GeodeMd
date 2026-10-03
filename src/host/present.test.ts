import { describe, expect, it } from "vitest";
import {
  erasePreviewText,
  dueNowText,
  restingText,
  unnestedReason,
  ANCESTORS_SHOWN,
  cardContext,
  CRUMB_MAX,
  syntaxChangedText,
  ACTION_KEYS,
  actionsAt,
  deferralReason,
  emptyCounts,
  interpretAnnotatingKey,
  interpretKey,
  interpretViewingKey,
  PHASE_LABEL,
  RATING_KEYS,
  ratingBreakdown,
  rescheduledText,
  summaryFields,
  backlogCapped,
  COUNT_CAP,
  exerciseReason,
  isSpot,
  locatorFor,
  ratingKeysFor,
  repeatText,
  SPOT_PROMPT,
  startOfDay,
  clockText,
  interpretPracticeKey,
  nextSolveText,
  practiceKeysAt,
  relatedLines,
  sessionBreakdown,
  SOLVE_RATING_KEYS,
} from "./present.js";
import type { SpotReview, SyncSummary } from "../core/index.js";

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
    expect(RATING_KEYS.map(([, l]) => l)).toEqual(["forgot", "hard", "good", "easy"]);
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
    // Each against the table that is live where it is offered: the note
    // viewer's keys are read by `interpretViewingKey`, not `interpretKey`.
    for (const { key, stage } of ACTION_KEYS) {
      const kind = stage === "note" ? interpretViewingKey(key).kind : interpretKey(key).kind;
      expect(kind, `${key} at ${stage}`).not.toBe("ignore");
    }
  });

  it("gives the note viewer its own keys, and none of the review's", () => {
    // #51: `3` must not rate a card hidden behind the note, and `q` must not
    // end the session from behind it.
    expect(actionsAt("note").map((a) => a.key)).toEqual(["o", "e"]);
    for (const k of ["1", "2", "3", "4", "q", "0", "a", " ", "ArrowDown"]) {
      expect(interpretViewingKey(k), k).toEqual({ kind: "ignore" });
    }
    for (const k of ["o", "O", "Escape"]) expect(interpretViewingKey(k), k).toEqual({ kind: "close" });
    expect(interpretViewingKey("e")).toEqual({ kind: "editor" });
  });

  it("offers `later` only at the question and `open` only at the answer", () => {
    // The two are deliberate opposites. `0` means "I am not ready to answer
    // this", which stops being true the moment the answer is showing; `o`
    // needs the answer on screen to be worth offering.
    expect(actionsAt("question").map((a) => a.key)).toEqual(["0", "q"]);
    expect(actionsAt("answer").map((a) => a.key)).toEqual(["o", "a", "q"]);
  });

  it("offers `annotate` at the answer only, because an annotation may restate it", () => {
    // ADR 0029: showing annotations before the reveal would make the review a
    // sham test, the mirror image of why `0` is question-only.
    expect(ACTION_KEYS.find((a) => a.key === "a")).toEqual({
      key: "a",
      label: "annotate",
      stage: "answer",
      cardsOnly: true,
    });
    expect(actionsAt("question").map((a) => a.key)).not.toContain("a");
    expect(interpretKey("a")).toEqual({ kind: "annotate" });
    expect(interpretKey("A")).toEqual({ kind: "annotate" });
  });

  it("treats every key as text while an annotation is open, except the two that close it", () => {
    // Typing "3 seconds, not quick" must not rate the card or quit the
    // session, so nothing from the review table applies here.
    for (const k of ["1", "3", "4", "0", "q", "Q", "o", "a", " ", "Enter", "Backspace"]) {
      expect(interpretAnnotatingKey(k, false), k).toEqual({ kind: "type" });
    }
    // Escape saves and closes rather than quitting; so does Cmd/Ctrl+Enter.
    expect(interpretAnnotatingKey("Escape", false)).toEqual({ kind: "close" });
    expect(interpretAnnotatingKey("Enter", true)).toEqual({ kind: "close" });
  });

  it("offers quit at both stages, because a question you cannot leave is a trap", () => {
    for (const stage of ["question", "answer"] as const) {
      expect(actionsAt(stage).some((a) => a.key === "q"), stage).toBe(true);
    }
    // And not over the note, where the session it would end is out of sight.
    expect(actionsAt("note").some((a) => a.key === "q")).toBe(false);
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
    expect(ratingBreakdown(counts).map((r) => r.label)).toEqual(["forgot", "good", "easy"]);
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
  cardLinesUnnested: 0,
  unnestedAt: [],
  exercisesFound: 0,
  exercisesUnreadable: 0,
  exercisesWithoutSolution: 0,
  exerciseProblemsAt: [],
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

describe("what is shown above a question", () => {
  const h = (text: string) => ({ kind: "heading" as const, text });
  const i = (text: string, answer?: string) =>
    answer === undefined ? { kind: "item" as const, text } : { kind: "item" as const, text, answer };
  const question = { revealed: false, expanded: false };

  it("puts the note and its headings on the path line, and the bullets in the outline", () => {
    const card = {
      filePath: "bio/cells.md",
      answer: "makes ribosomes",
      context: [h("Biology"), i("Cell"), i("Nucleus", "holds DNA")],
    };
    expect(cardContext(card, question)).toEqual({
      path: ["cells", "Biology"],
      folded: 0,
      parents: [{ text: "Cell" }, { text: "Nucleus", answer: "holds DNA" }],
    });
  });

  it("is just the note's name for a card with nothing above it", () => {
    expect(cardContext({ filePath: "Lambda.markdown", answer: "x", context: [] }, question)).toEqual({
      path: ["Lambda"],
      folded: 0,
      parents: [],
    });
  });

  it("shortens a long path segment on its own", () => {
    const long = "x".repeat(CRUMB_MAX + 10);
    const { path } = cardContext({ filePath: "a.md", answer: "z", context: [h(long), h("near")] }, question);
    expect([...path[1]!]).toHaveLength(CRUMB_MAX);
    expect(path[1]!.endsWith("…")).toBe(true);
    expect(path[2]).toBe("near");
  });

  it("does not shorten a parent bullet, which is cut by lines instead", () => {
    const long = "y".repeat(CRUMB_MAX * 3);
    expect(cardContext({ filePath: "a.md", answer: "z", context: [i(long)] }, question).parents).toEqual([
      { text: long },
    ]);
  });

  it(`shows the nearest ${ANCESTORS_SHOWN} parents and folds the older ones`, () => {
    const context = ["1", "2", "3", "4", "5"].map((t) => i(t));
    const shown = cardContext({ filePath: "a.md", answer: "z", context }, question);
    expect(shown.folded).toBe(2);
    expect(shown.parents.map((p) => p.text)).toEqual(["3", "4", "5"]);

    const all = cardContext({ filePath: "a.md", answer: "z", context }, { revealed: false, expanded: true });
    expect(all.folded).toBe(0);
    expect(all.parents).toHaveLength(5);
  });

  it("leaves out a parent whose text is in the answer until the answer shows", () => {
    const card = {
      filePath: "a.md",
      answer: "The   MITOCHONDRIA, in every cell",
      context: [i("Organelles"), i("mitochondria")],
    };
    expect(cardContext(card, question).parents).toEqual([{ text: "Organelles" }]);
    expect(cardContext(card, { revealed: true, expanded: false }).parents).toHaveLength(2);
  });

  it("leaves a spoiler out before folding, so the nearest parents that can be shown are", () => {
    const card = { filePath: "a.md", answer: "spoiler", context: ["1", "2", "3", "4"].map((t) => i(t)).concat(i("spoiler")) };
    const shown = cardContext(card, question);
    expect(shown.parents.map((p) => p.text)).toEqual(["2", "3", "4"]);
    expect(shown.folded).toBe(1);
  });

  it("never treats a heading as a spoiler, nor whitespace as text", () => {
    const card = { filePath: "a.md", answer: "Biology", context: [h("Biology"), i("  ")] };
    const shown = cardContext(card, question);
    expect(shown.path).toEqual(["a", "Biology"]);
    expect(shown.parents).toEqual([{ text: "  " }]);
  });
});

describe("what the app says when the card syntax changed", () => {
  it("names both separators, the one that stopped, and the preview", () => {
    const text = syntaxChangedText();
    for (const part of [">>", "==", "::", "preview"]) expect(text).toContain(part);
  });
});

describe("what the app says about card lines that are not nested", () => {
  it("says nothing when there are none", () => {
    expect(unnestedReason({ cardLinesUnnested: 0, unnestedAt: [] })).toBeNull();
  });

  it("names where they are, why, and the fix", () => {
    const text = unnestedReason({ cardLinesUnnested: 1, unnestedAt: ["a.md:4"] })!;
    for (const part of ["a.md:4", "list marker", "Markdown", '"- "']) expect(text).toContain(part);
  });

  it("says how many more there are than it names", () => {
    const text = unnestedReason({ cardLinesUnnested: 12, unnestedAt: ["a.md:1", "a.md:2"] })!;
    expect(text).toContain("12 lines look like cards");
    expect(text).toContain("a.md:1, a.md:2, and 10 more");
  });
});

describe("what the app says about cards not due yet, and cards due now", () => {
  it("names how many cards come back, and at what time", () => {
    const at = new Date(2026, 9, 2, 12, 6);
    expect(restingText(1, at)).toMatch(/^1 card comes back at 12:06/);
    expect(restingText(2, at)).toMatch(/^2 cards come back at 12:06/);
  });

  it("counts cards due now, as a floor when the count stopped at the cap", () => {
    expect(dueNowText(3, false)).toBe("3 due now");
    expect(dueNowText(10000, true)).toBe("10000+ due now");
  });
});

describe("what an erase says it will remove", () => {
  const sr = { exists: true, logShards: 2, annotations: 1, archives: 0 };

  it("counts id comments, notes and what .sr/ holds", () => {
    expect(erasePreviewText({ stamps: { files: 3, stamps: 40, unreadable: [] }, sr })).toBe(
      "40 id comments in 3 notes will be taken out; .sr/ holds 2 review log files, 1 annotation and 0 archived fresh starts.",
    );
  });

  it("says so when there is nothing to take out, and no .sr/", () => {
    const none = { exists: false, logShards: 0, annotations: 0, archives: 0 };
    expect(erasePreviewText({ stamps: { files: 0, stamps: 0, unreadable: [] }, sr: none })).toBe(
      "No note holds an id comment; there is no .sr/ folder.",
    );
  });

  it("warns that unreadable notes will stop it", () => {
    expect(erasePreviewText({ stamps: { files: 1, stamps: 1, unreadable: ["x.md"] }, sr })).toContain(
      "1 note could not be read, so the erase will stop before deleting anything",
    );
  });
});

describe("how a spot review is worded and offered", () => {
  const spot: SpotReview = {
    kind: "spot",
    id: "spot:greedy",
    skill: "greedy",
    title: "Jump Game",
    statement: "Reach the end.",
    skills: ["greedy"],
    filePath: "greedy/jump-game.md",
    lineNo: null,
    locator: "greedy/jump-game.md",
    repeat: false,
    related: { pool: [], others: [] },
  };
  const card = { id: "sr-000000000001", question: "Q", answer: "A", filePath: "a.md", lineNo: 1, locator: "a.md:1", context: [] };

  it("names its ratings by what happened, with the same four keys", () => {
    expect(ratingKeysFor(spot)).toEqual([
      ["1", "wrong skill"],
      ["2", "right, after hesitating"],
      ["3", "right"],
      ["4", "right, at once"],
    ]);
    expect(ratingKeysFor(spot).map(([k]) => k)).toEqual(RATING_KEYS.map(([k]) => k));
    expect(ratingKeysFor(card)).toBe(RATING_KEYS);
    expect(SPOT_PROMPT).toBe("Which skill does this call for?");
  });

  it("offers no annotation, having no stamp to name one by", () => {
    expect(actionsAt("answer", true).map((a) => a.key)).toEqual(["o", "q"]);
    expect(actionsAt("question", true).map((a) => a.key)).toEqual(["0", "q"]);
    expect(actionsAt("answer").map((a) => a.key)).toContain("a");
  });

  it("keeps the note's path hidden until the answer, since a folder can name the skill", () => {
    expect(locatorFor(spot, false)).toBeNull();
    expect(locatorFor(spot, true)).toBe("greedy/jump-game.md");
    expect(locatorFor(card, false)).toBe("a.md:1");
    expect(isSpot(spot)).toBe(true);
    expect(isSpot(card)).toBe(false);
  });

  it("says a repeat's pool has run out, and what to do about it", () => {
    expect(repeatText("greedy")).toBe("You have seen every exercise for greedy. Add one to its pool.");
  });

  it("measures 'served today' from the start of the local day", () => {
    const now = new Date(2026, 9, 5, 20, 18, 11);
    expect(startOfDay(now)).toEqual(new Date(2026, 9, 5, 0, 0, 0, 0));
  });

  it("counts spot reviews into the backlog's cap", () => {
    expect(backlogCapped({ dueNow: 0, newCards: 0, spotsDue: COUNT_CAP })).toBe(true);
    expect(backlogCapped({ dueNow: 0, newCards: 0, spotsDue: 3 })).toBe(false);
  });
});

describe("what a sync summary says about exercises", () => {
  const base = {
    exercisesFound: 0,
    exercisesUnreadable: 0,
    exercisesWithoutSolution: 0,
    exerciseProblemsAt: [] as string[],
  };

  it("says nothing about exercises in a vault that has none", () => {
    const fields = summaryFields(summary(base)).map((f) => f.key);
    expect(fields.filter((k) => k.startsWith("exercise"))).toEqual([]);
    expect(exerciseReason(base)).toBeNull();
  });

  it("counts the exercises found and the ones it could not serve", () => {
    const s = summary({ ...base, exercisesFound: 4, exercisesUnreadable: 1, exercisesWithoutSolution: 1 });
    expect(summaryFields(s).filter((f) => f.key.startsWith("exercise")).map((f) => [f.label, f.value])).toEqual([
      ["exercises found", 4],
      ["exercises with unreadable properties", 1],
      ["exercises with no ## Solution", 1],
    ]);
  });

  it("names the notes it left out, and the fix", () => {
    expect(exerciseReason({ ...base, exercisesWithoutSolution: 1, exerciseProblemsAt: ["a.md"] })).toBe(
      '1 note names its skills but is not served: a.md. An exercise needs geode-skills to be a list, like [two-pointers, greedy], and a "## Solution" heading where its statement ends.',
    );
    expect(
      exerciseReason({ ...base, exercisesUnreadable: 12, exerciseProblemsAt: ["a.md", "b.md"] }),
    ).toContain("12 notes name their skills but are not served: a.md, b.md, and 10 more.");
  });
});

describe("how the Practice screen is worded and keyed", () => {
  it("names the solve ratings by what happened, with the same four keys", () => {
    expect(SOLVE_RATING_KEYS).toEqual([
      ["1", "couldn't solve it"],
      ["2", "solved with help"],
      ["3", "solved on my own"],
      ["4", "solved on my own, easily"],
    ]);
  });

  it("stops the clock on Space or Enter only, and offers leave at both stages", () => {
    expect(interpretPracticeKey(" ")).toEqual({ kind: "done" });
    expect(interpretPracticeKey("Enter")).toEqual({ kind: "done" });
    expect(interpretPracticeKey("x")).toEqual({ kind: "ignore" });
    // Escape would discard half an hour by reflex; leaving takes `q` (#81).
    expect(interpretPracticeKey("Escape")).toEqual({ kind: "ignore" });
    expect(practiceKeysAt("solving").map((k) => k.shown)).toEqual(["space", "q"]);
    expect(practiceKeysAt("solved").map((k) => k.shown)).toEqual(["o", "q"]);
  });

  it("shows the clock as m:ss, and h:mm:ss past the hour", () => {
    expect(clockText(0)).toBe("0:00");
    expect(clockText(38 * 60_000 + 4_500)).toBe("38:04");
    expect(clockText(3_725_000)).toBe("1:02:05");
  });

  it("says when a skill comes back as a date", () => {
    expect(nextSolveText("greedy", new Date(2026, 9, 12, 19, 54))).toMatch(/^greedy comes back for a solve on .*12/);
  });

  it("lists the rest of the pool, then who shares each other skill", () => {
    const related = {
      pool: [{ path: "j.md", title: "Jump Game" }],
      others: [{ skill: "two-pointers", exercises: [{ path: "t.md", title: "Trapping Rain Water" }] }],
    };
    expect(relatedLines({ skill: "greedy", related })).toEqual([
      { label: "Also in greedy", titles: ["Jump Game"] },
      { label: "Also tagged two-pointers, with", titles: ["Trapping Rain Water"] },
    ]);
    expect(relatedLines({ skill: "greedy", related: { pool: [], others: [] } })).toEqual([]);
  });

  it("tallies spot reviews in their own words, after the cards", () => {
    expect(sessionBreakdown({ 1: 0, 2: 0, 3: 2, 4: 0 }, { 1: 1, 2: 0, 3: 0, 4: 0 })).toEqual([
      { label: "good", count: 2 },
      { label: "wrong skill (spot)", count: 1 },
    ]);
  });
});
