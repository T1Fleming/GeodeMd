import { describe, expect, it } from "vitest";
import type { SolveReview } from "../../../core/index.js";
import { clockState, elapsed, noteArrived, press, recorded, resumable, start } from "./practice.js";
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
  /** Started at minute 0, done at `minutes`: the plain run of a solve. */
  const solvedAt = (minutes: number): Practice => press(press(start(review), " ", T0).next, "d", at(minutes)).next;

  it("waits for Space to start the clock, so reading the problem is not solving it", () => {
    // Seen in testing (#81): the clock started on the offer, so a solve left
    // open across a day logged a day.
    const offered = start(review);
    expect(clockState(offered)).toBe("not-started");
    expect(elapsed(offered, at(30))).toBe(0);
    const running = press(offered, " ", at(30)).next;
    expect(clockState(running)).toBe("running");
    expect(elapsed(running, at(52))).toBe(22 * 60);
  });

  it("pauses and resumes on Space, counting only the time it ran", () => {
    let p = press(start(review), " ", T0).next;
    p = press(p, " ", at(10)).next;
    expect(clockState(p)).toBe("paused");
    expect(elapsed(p, at(40))).toBe(10 * 60);
    p = press(p, " ", at(40)).next;
    const { next, effect } = press(p, "d", at(45));
    expect(next).toEqual({ at: "solved", review, took: 15 * 60, note: null });
    expect(effect).toEqual({ kind: "read-note", review });
    // Stopped: the clock does not move once the solution is showing.
    expect(elapsed(next, at(60))).toBe(15 * 60);
  });

  it("shows the solution only on d, never on Space, so the reflexive key cannot give it away", () => {
    // Seen in testing (#81): Space meant done, was pressed to start, and
    // solves were logged at one second.
    const solving = start(review);
    expect(press(solving, " ", at(1)).next.at).toBe("solving");
    for (const key of ["3", "o", "x", "a", "Enter"]) expect(press(solving, key, at(30)).next, key).toBe(solving);
    expect(press(solving, "d", at(30)).next.at).toBe("solved");
  });

  it("finishes from a clock that never started, counting nothing", () => {
    expect(press(start(review), "d", at(5)).next).toEqual({ at: "solved", review, took: 0, note: null });
  });

  it("hides and shows the clock on h, which changes nothing about the solve", () => {
    const solving = press(start(review), " ", T0).next;
    expect(press(solving, "h", at(3))).toEqual({ next: solving, effect: { kind: "clock" } });
  });

  it("records the rating with the time taken, and offers no second solve", () => {
    const solved = noteArrived(solvedAt(14), "# Jump Game\n");
    const { next, effect } = press(solved, "4", at(15));
    expect(effect).toEqual({ kind: "rate", review, rating: 4, took: 14 * 60 });
    const done = recorded(next, "2026-10-12T19:54:00.000Z");
    expect(done).toEqual({ at: "done", review, rating: 4, next: "2026-10-12T19:54:00.000Z" });
    expect(press(done, " ", at(16)).next).toBe(done);
    expect(press(done, "3", at(16)).effect).toBeUndefined();
  });

  it("keeps the solve when a rating fails, so it can be given again", () => {
    const saving = press(noteArrived(solvedAt(14), "n"), "3", at(15)).next;
    expect(recorded(saving, null, true)).toEqual({ at: "solved", review, took: 14 * 60, note: "n" });
  });

  it("records nothing when you leave, before or after the reveal", () => {
    const solving = start(review);
    expect(press(solving, "q", at(5))).toEqual({ next: { at: "left" } });
    expect(press(solvedAt(5), "q", at(6))).toEqual({ next: { at: "left" } });
  });

  it("ignores Escape, which would throw away a solve by reflex", () => {
    const solving = start(review);
    expect(press(solving, "Escape", at(20)).next).toBe(solving);
    const solved = solvedAt(20);
    expect(press(solved, "Escape", at(21)).next).toBe(solved);
  });

  it("picks a solve under way back up on return to the tab, and nothing finished", () => {
    const solving = press(start(review), " ", T0).next;
    const solved = press(solving, "d", at(5)).next;
    const saving = press(solved, "3", at(6)).next;
    expect([start(review), solving, solved, saving].every(resumable)).toBe(true);
    expect(resumable(recorded(saving, null))).toBe(false);
    expect(resumable(press(solving, "q", at(5)).next)).toBe(false);
    expect(resumable(null)).toBe(false);
    // A running clock ran on while the tab was elsewhere; pause it to stop that.
    expect(elapsed(solving, at(25))).toBe(25 * 60);
  });

  it("opens the note in an editor once the solution is showing, and not before", () => {
    expect(press(start(review), "o", at(1)).effect).toBeUndefined();
    const solved = press(start(review), "d", at(1)).next;
    expect(press(solved, "o", at(2)).effect).toEqual({ kind: "open", review });
  });

  it("drops a note that arrives after the rating", () => {
    const saving = press(press(start(review), "d", at(1)).next, "3", at(2)).next;
    expect(noteArrived(saving, "late")).toBe(saving);
  });
});
