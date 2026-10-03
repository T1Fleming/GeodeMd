import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { chooseExercise, Core, isSpot } from "./index.js";
import type { SkillKind } from "./index.js";
import { Store } from "../store/index.js";
import type { PoolEntry } from "../store/index.js";

/**
 * Exercises (ADR 0038): a note opted in by `geode-skills`, a skill scheduled
 * in its place, and a different exercise served from the skill's pool each
 * time it comes due.
 */

let notes: string;
let store: Store;
let core: Core;
let idCounter: number;

const MTIME = new Date("2026-09-01T00:00:00.000Z");
const T0 = new Date("2026-10-05T08:00:00.000Z");

beforeEach(async () => {
  notes = await fs.mkdtemp(path.join(os.tmpdir(), "geode-exercises-"));
  store = new Store(":memory:");
  idCounter = 0;
  core = new Core(
    {
      notesPath: notes,
      device: "test",
      dbPath: ":memory:",
      newId: () => `sr-${String(++idCounter).padStart(12, "0")}`,
    },
    store,
  );
});

afterEach(async () => {
  store.close();
  await fs.rm(notes, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(notes, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  await fs.utimes(abs, MTIME, MTIME);
}

function exercise(skills: string[], title = "T"): string {
  return `---\ngeode-skills: [${skills.join(", ")}]\n---\n# ${title}\n\nThe problem.\n\n## Solution\n\nThe answer.\n`;
}

/** The worked example's notes, in ADR 0038 and #77. */
async function workedExample(): Promise<void> {
  await write("leetcode/container-with-most-water.md", exercise(["two-pointers", "greedy"], "Container With Most Water"));
  await write("leetcode/daily-temperatures.md", exercise(["monotonic-stack"], "Daily Temperatures"));
  await write("leetcode/jump-game.md", exercise(["greedy"], "Jump Game"));
  await write("leetcode/trapping-rain-water.md", exercise(["two-pointers", "monotonic-stack"], "Trapping Rain Water"));
  await core.sync(T0);
}

/** Midnight UTC of the day `at` falls on, standing in for the user's local day. */
function dayOf(at: string): Date {
  return new Date(`${at.slice(0, 10)}T00:00:00.000Z`);
}

/** Which exercise serving would pick for (skill, kind) at `at`, by path. */
function pick(skill: string, kind: SkillKind, at: string): string {
  return chooseExercise(store.poolOf(skill, kind), dayOf(at).toISOString())!.path;
}

async function rate(skill: string, kind: SkillKind, at: string, rating: 1 | 2 | 3 | 4): Promise<string> {
  const exercise = pick(skill, kind, at);
  const repeat = store.poolOf(skill, kind).find((e) => e.path === exercise)!.seen === 1;
  await core.reviewSkill({ skill, kind, exercise, repeat }, rating, new Date(at));
  return exercise.replace(/^leetcode\/|\.md$/g, "");
}

describe("sync reads a note's skills into pools", () => {
  it("puts an exercise in every pool it names, and writes nothing into the note", async () => {
    const text = exercise(["two-pointers", "greedy"], "Container");
    await write("c.md", text);
    const summary = await core.sync(T0);

    expect(summary.exercisesFound).toBe(1);
    expect(store.getExercise("c.md")).toEqual({ path: "c.md", title: "Container", statement: "The problem." });
    expect(store.skillsOfExercise("c.md")).toEqual(["greedy", "two-pointers"]);
    expect(store.countSkills()).toBe(2);
    expect(await fs.readFile(path.join(notes, "c.md"), "utf8")).toBe(text);
  });

  it("titles an exercise with no heading by its file name", async () => {
    await write("leetcode/jump-game.md", "---\ngeode-skills: [greedy]\n---\nReach the end.\n## Solution\n");
    await core.sync(T0);
    expect(store.getExercise("leetcode/jump-game.md")?.title).toBe("jump-game");
  });

  it("reports an exercise it cannot serve, and leaves it out of every pool", async () => {
    await write("bad.md", "---\ngeode-skills: [greedy\n---\n# T\n## Solution\n");
    await write("open.md", "---\ngeode-skills: [greedy]\n---\n# T\nThe whole answer, unmarked.\n");
    const summary = await core.sync(T0);

    expect(summary.exercisesUnreadable).toBe(1);
    expect(summary.exercisesWithoutSolution).toBe(1);
    expect(summary.exerciseProblemsAt.sort()).toEqual(["bad.md", "open.md"]);
    expect(store.countExercises()).toBe(0);
  });

  it("takes a note out of its pools when the property or the heading goes, or the note does", async () => {
    await write("a.md", exercise(["greedy"]));
    await write("b.md", exercise(["greedy"]));
    await core.sync(T0);
    expect(store.countExercises()).toBe(2);

    await write("a.md", "# T\n\nNo longer an exercise.\n");
    await fs.rm(path.join(notes, "b.md"));
    await core.sync(new Date(T0.getTime() + 60_000), { full: true });
    expect(store.countExercises()).toBe(0);
    expect(store.countSkills()).toBe(0);
  });

  it("previews without writing a row", async () => {
    await write("a.md", exercise(["greedy"]));
    const summary = await core.sync(T0, { dryRun: true });
    expect(summary.exercisesFound).toBe(1);
    expect(store.countExercises()).toBe(0);
  });

  it("re-reads every note once when the exercise rules change, so an untouched note is found", async () => {
    await write("a.md", exercise(["greedy"]));
    await core.sync(T0);
    // A database from before this build: no exercise rows, and no version.
    store.putExercise("a.md", null);
    store.db.prepare("DELETE FROM meta WHERE key = 'exercise'").run();

    const summary = await core.sync(new Date(T0.getTime() + 60_000));
    expect(summary.filesRead).toBe(1);
    expect(store.countExercises()).toBe(1);
    expect((await core.sync(new Date(T0.getTime() + 120_000))).filesRead).toBe(0);
  });
});

describe("which exercise a skill is served with", () => {
  const entry = (path: string, last_any: string | null, seen = 0): PoolEntry => ({ path, last_any, seen });
  const DAY = "2026-10-08T00:00:00.000Z";

  it("prefers one not served today, then one fresh to this skill, then the least recent, then by path", () => {
    expect(chooseExercise([entry("a", "2026-10-08T07:00:00.000Z"), entry("b", "2026-10-07T07:00:00.000Z", 1)], DAY)!.path).toBe("b");
    expect(chooseExercise([entry("a", "2026-10-01T00:00:00.000Z", 1), entry("b", "2026-10-06T00:00:00.000Z")], DAY)!.path).toBe("b");
    expect(chooseExercise([entry("a", "2026-10-06T00:00:00.000Z", 1), entry("b", "2026-10-01T00:00:00.000Z", 1)], DAY)!.path).toBe("b");
    expect(chooseExercise([entry("a", "2026-10-01T00:00:00.000Z"), entry("b", null)], DAY)!.path).toBe("b");
    expect(chooseExercise([entry("b", null), entry("a", null)], DAY)!.path).toBe("a");
    expect(chooseExercise([], DAY)).toBeNull();
  });

  it("counts one already chosen in this sitting as served today", () => {
    const pool = [entry("a", null), entry("b", null)];
    expect(chooseExercise(pool, DAY, new Set(["a"]))!.path).toBe("b");
  });

  it("makes the worked example's nine picks, in order", async () => {
    await workedExample();
    const served = [
      await rate("two-pointers", "spot", "2026-10-05T08:12:44.120Z", 3),
      await rate("greedy", "spot", "2026-10-05T08:13:02.871Z", 4),
      await rate("monotonic-stack", "spot", "2026-10-05T08:13:30.415Z", 4),
      await rate("two-pointers", "solve", "2026-10-05T20:18:11.902Z", 2),
      await rate("monotonic-stack", "spot", "2026-10-08T08:05:19.330Z", 3),
      await rate("greedy", "solve", "2026-10-08T19:22:47.006Z", 4),
      await rate("greedy", "spot", "2026-10-19T08:31:55.184Z", 4),
      await rate("greedy", "spot", "2026-11-02T08:09:40.551Z", 4),
    ];
    expect(served).toEqual([
      "container-with-most-water",
      "jump-game",
      "daily-temperatures",
      "trapping-rain-water",
      "trapping-rain-water",
      "container-with-most-water",
      "container-with-most-water",
      "jump-game",
    ]);
    expect(pick("monotonic-stack", "solve", "2026-11-02T09:00:00.000Z")).toBe("leetcode/daily-temperatures.md");

    // Only the last was a repeat: greedy had spotted both its exercises.
    const lines = (await fs.readFile(path.join(notes, ".sr", "log", "test-2026-11.jsonl"), "utf8")).trim().split("\n");
    expect(JSON.parse(lines[0]!)).toEqual({
      skill: "greedy",
      kind: "spot",
      exercise: "leetcode/jump-game.md",
      at: "2026-11-02T08:09:40.551Z",
      rating: 4,
      repeat: true,
    });
  });
});

describe("a spot review is in the sitting, asked with an exercise from the pool", () => {
  it("serves due cards, then skills due for a spot review, then new cards", async () => {
    await write("cards.md", "Q1 >> A1\nQ2 >> A2\n");
    await write("ex.md", exercise(["greedy"], "Jump Game"));
    await core.sync(T0);
    await core.reviewCard("sr-000000000001", 1, T0);

    const later = new Date(T0.getTime() + 15 * 60_000);
    const items = core.getReviewItems(later, dayOf(later.toISOString()), 10);
    expect(items.map((i) => (isSpot(i) ? `spot ${i.skill}` : i.question))).toEqual(["Q1", "spot greedy", "Q2"]);
  });

  it("carries the title, the statement and every skill, and nothing that names the skill asked", async () => {
    await write("monotonic-stack/ex.md", exercise(["two-pointers", "greedy"], "Container"));
    await core.sync(T0);
    const [spot] = core.getSpotReviews(T0, dayOf(T0.toISOString()), 10);
    expect(spot).toEqual({
      kind: "spot",
      id: "spot:greedy",
      skill: "greedy",
      title: "Container",
      statement: "The problem.",
      skills: ["greedy", "two-pointers"],
      filePath: "monotonic-stack/ex.md",
      lineNo: null,
      locator: "monotonic-stack/ex.md",
      repeat: false,
    });
  });

  it("never puts one exercise in a sitting twice for two skills that share it", async () => {
    await write("a.md", exercise(["two-pointers", "greedy"]));
    await write("b.md", exercise(["two-pointers"]));
    await core.sync(T0);
    // Both pools would start with a.md by path; greedy takes it first.
    const spots = core.getSpotReviews(T0, dayOf(T0.toISOString()), 10);
    expect(spots.map((s) => [s.skill, s.filePath])).toEqual([
      ["greedy", "a.md"],
      ["two-pointers", "b.md"],
    ]);
  });

  it("never makes a skill with an empty pool due, and keeps its schedule for when it fills", async () => {
    await write("a.md", exercise(["greedy"]));
    await core.sync(T0);
    await core.reviewSkill({ skill: "greedy", kind: "spot", exercise: "a.md", repeat: false }, 1, T0);
    const due = store.getSkillState("greedy", "spot")!.due;

    await write("a.md", "# no longer an exercise\n");
    await core.sync(new Date(T0.getTime() + 60_000), { full: true });
    const far = new Date("2027-01-01T00:00:00.000Z");
    expect(core.getSpotReviews(far, far, 10)).toEqual([]);
    expect(store.getSkillState("greedy", "spot")!.due).toBe(due);
  });

  it("brings a skill back in days, never minutes, whatever the rating", async () => {
    await write("a.md", exercise(["greedy"]));
    await core.sync(T0);
    const next = await core.reviewSkill({ skill: "greedy", kind: "spot", exercise: "a.md", repeat: false }, 1, T0);
    expect(new Date(next.due).getTime() - T0.getTime()).toBeGreaterThanOrEqual(86_400_000);
    expect(core.getSpotReviews(new Date(T0.getTime() + 3_600_000), dayOf(T0.toISOString()), 10)).toEqual([]);
  });

  it("counts skills due for a spot review in the stats, capped like every other count", async () => {
    await write("a.md", exercise(["greedy", "two-pointers", "dp"]));
    await core.sync(T0);
    expect(core.stats(T0, 100).spotsDue).toBe(3);
    const capped = core.stats(T0, 2);
    expect(capped.spotsDue).toBe(2);
    expect(capped.capped).toBe(true);
  });
});

describe("skill reviews in the log", () => {
  it("records a spot review in the log before the database, as a card's is", async () => {
    await write("a.md", exercise(["greedy"]));
    await core.sync(T0);
    await core.reviewSkill({ skill: "greedy", kind: "solve", exercise: "a.md", repeat: false }, 2, T0, 1840.24);
    const line = (await fs.readFile(path.join(notes, ".sr", "log", "test-2026-10.jsonl"), "utf8")).trim();
    expect(JSON.parse(line)).toEqual({
      skill: "greedy",
      kind: "solve",
      exercise: "a.md",
      at: T0.toISOString(),
      rating: 2,
      took: 1840.2,
    });
  });

  it("reads skill reviews another device wrote", async () => {
    await write("a.md", exercise(["greedy"]));
    await core.sync(T0);
    const dir = path.join(notes, ".sr", "log");
    await fs.mkdir(dir, { recursive: true });
    const line = { skill: "greedy", kind: "spot", exercise: "a.md", at: T0.toISOString(), rating: 3 };
    await fs.appendFile(path.join(dir, "other-2026-10.jsonl"), `${JSON.stringify(line)}\n`);

    const ingest = await core.ingestLogs(T0);
    expect(ingest.reviewsIngested).toBe(1);
    expect(store.getSkillState("greedy", "spot")?.reps).toBe(1);
  });

  it("skips a malformed skill line as it skips a malformed card line", async () => {
    const dir = path.join(notes, ".sr", "log");
    await fs.mkdir(dir, { recursive: true });
    const bad = { skill: "greedy", kind: "later", exercise: "a.md", at: T0.toISOString(), rating: 3 };
    await fs.appendFile(path.join(dir, "other-2026-10.jsonl"), `${JSON.stringify(bad)}\n`);
    expect((await core.ingestLogs(T0)).linesSkipped).toBe(1);
  });

  it("reads again, once, the lines an older build skipped and moved past", async () => {
    await write("a.md", exercise(["greedy"]));
    await core.sync(T0);
    const dir = path.join(notes, ".sr", "log");
    const shard = path.join(dir, "other-2026-10.jsonl");
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(shard, `${JSON.stringify({ skill: "greedy", kind: "spot", exercise: "a.md", at: T0.toISOString(), rating: 3 })}\n`);

    // What an older build leaves: the shard read to its end, the line not in
    // the database, and no record of which lines it understood.
    const size = (await fs.stat(shard)).size;
    store.setLogCursor("other-2026-10.jsonl", size, size);
    store.db.prepare("DELETE FROM meta WHERE key = 'log-reader'").run();

    expect((await core.ingestLogs(T0)).reviewsIngested).toBe(1);
    expect(store.countSkillReviews()).toBe(1);
    // Once: the next ingest does not open the shard again.
    expect((await core.ingestLogs(T0)).shardsSkipped).toBe(1);
  });

  it("re-derives skill schedules when the skill scheduler changes", async () => {
    await write("a.md", exercise(["greedy"]));
    await core.sync(T0);
    await core.reviewSkill({ skill: "greedy", kind: "spot", exercise: "a.md", repeat: false }, 3, T0);
    const right = store.getSkillState("greedy", "spot");

    store.putSkillState("greedy", "spot", { ...right!, due: "2099-01-01T00:00:00.000Z" });
    store.setMeta("skill-scheduler", "an older one");
    await core.adoptScheduler(T0);
    expect(store.getSkillState("greedy", "spot")).toEqual(right);
  });
});
