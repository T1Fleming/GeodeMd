import { describe, expect, it } from "vitest";
import type { SolveReview } from "../../../core/index.js";
import { elapsed, noteArrived, press, recorded, resumable, start } from "./practice.js";
import type { Practice } from "./practice.js";

const review: SolveReview = {
  kind: "solve",
  id: "solve:greedy",
  skill: "greedy",
  title: "Jump Game",
  statement: "Reach the end.",
  skills: ["greedy"],
  filePath: "jump-game.md",
  lineNo: null,
  locator: "jump-game.md",
  repeat: false,
  related: { pool: [], others: [] },
};

const T0 = new Date("2026-10-05T19:40:00.000Z");
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);

describe("a solve on the Practice screen", () => {
  it("times the attempt from the moment the problem is shown to the moment you say you are done", () => {
    const solving = start(review, T0);
    expect(elapsed(solving, at(22))).toBe(22 * 60);
    const { next, effect } = press(solving, " ", at(38));
    expect(next).toEqual({ at: "solved", review, took: 38 * 60, note: null });
    expect(effect).toEqual({ kind: "read-note", review });
    // Stopped: the clock does not move once the solution is showing.
    expect(elapsed(next, at(60))).toBe(38 * 60);
  });

  it("stops only on Space or Enter, so a stray key half an hour in shows nothing", () => {
    const solving = start(review, T0);
    for (const key of ["3", "o", "x", "a"]) expect(press(solving, key, at(30)).next, key).toBe(solving);
    expect(press(solving, "Enter", at(30)).next.at).toBe("solved");
  });

  it("records the rating with the time taken, and offers no second solve", () => {
    const solved = noteArrived(press(start(review, T0), " ", at(14)).next, "# Jump Game\n");
    const { next, effect } = press(solved, "4", at(15));
    expect(effect).toEqual({ kind: "rate", review, rating: 4, took: 14 * 60 });
    const done = recorded(next, "2026-10-12T19:54:00.000Z");
    expect(done).toEqual({ at: "done", review, rating: 4, next: "2026-10-12T19:54:00.000Z" });
    expect(press(done, " ", at(16)).next).toBe(done);
    expect(press(done, "3", at(16)).effect).toBeUndefined();
  });

  it("keeps the solve when a rating fails, so it can be given again", () => {
    const saving = press(noteArrived(press(start(review, T0), " ", at(14)).next, "n"), "3", at(15)).next;
    expect(recorded(saving, null, true)).toEqual({ at: "solved", review, took: 14 * 60, note: "n" });
  });

  it("records nothing when you leave, before or after the reveal", () => {
    const solving = start(review, T0);
    expect(press(solving, "q", at(5))).toEqual({ next: { at: "left" } });
    const solved: Practice = press(solving, " ", at(5)).next;
    expect(press(solved, "q", at(6))).toEqual({ next: { at: "left" } });
  });

  it("ignores Escape, which would throw away a solve by reflex", () => {
    const solving = start(review, T0);
    expect(press(solving, "Escape", at(20)).next).toBe(solving);
    const solved = press(solving, " ", at(20)).next;
    expect(press(solved, "Escape", at(21)).next).toBe(solved);
  });

  it("picks a solve under way back up on return to the tab, and nothing finished", () => {
    const solving = start(review, T0);
    const solved = press(solving, " ", at(5)).next;
    const saving = press(solved, "3", at(6)).next;
    expect([solving, solved, saving].every(resumable)).toBe(true);
    expect(resumable(recorded(saving, null))).toBe(false);
    expect(resumable(press(solving, "q", at(5)).next)).toBe(false);
    expect(resumable(null)).toBe(false);
    // The clock ran on while the tab was elsewhere: it measures the solve, not the screen.
    expect(elapsed(solving, at(25))).toBe(25 * 60);
  });

  it("opens the note in an editor once the solution is showing, and not before", () => {
    expect(press(start(review, T0), "o", at(1)).effect).toBeUndefined();
    const solved = press(start(review, T0), " ", at(1)).next;
    expect(press(solved, "o", at(2)).effect).toEqual({ kind: "open", review });
  });

  it("drops a note that arrives after the rating", () => {
    const saving = press(press(start(review, T0), " ", at(1)).next, "3", at(2)).next;
    expect(noteArrived(saving, "late")).toBe(saving);
  });
});
