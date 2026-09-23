import { describe, expect, it } from "vitest";
import { colorEnabled, columns, styler, wrap } from "./style.js";

const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;

describe("when colour is used, and when it is not", () => {
  it("follows the terminal when nothing says otherwise", () => {
    expect(colorEnabled(env({}), true)).toBe(true);
    expect(colorEnabled(env({}), false)).toBe(false);
  });

  it("lets NO_COLOR win over everything, FORCE_COLOR included", () => {
    // One is a user saying no; the other is usually a script guessing.
    expect(colorEnabled(env({ NO_COLOR: "1", FORCE_COLOR: "1" }), true)).toBe(false);
    expect(colorEnabled(env({ NO_COLOR: "" }), true)).toBe(true);
  });

  it("colours a pipe when FORCE_COLOR asks", () => {
    expect(colorEnabled(env({ FORCE_COLOR: "1" }), false)).toBe(true);
  });

  it("says no to a dumb terminal", () => {
    expect(colorEnabled(env({ TERM: "dumb" }), true)).toBe(false);
  });
});

describe("styling text, or leaving it plain", () => {
  it("is the identity when disabled, not a stripped escape", () => {
    const s = styler(false);
    expect(s.bold("x")).toBe("x");
    expect(s.dim("x")).toBe("x");
  });

  it("wraps and closes the sequence when enabled", () => {
    const esc = String.fromCharCode(27);
    expect(styler(true).bold("x")).toBe(`${esc}[1mx${esc}[0m`);
  });
});

describe("how wide the terminal is", () => {
  it("defaults when the stream has no width", () => {
    expect(columns({})).toBe(80);
    // A pty opened without a winsize reports 0, which means unknown — not the
    // narrowest column we are willing to set prose in.
    expect(columns({ columns: 0 })).toBe(80);
  });

  it("clamps both ends, because prose is not the window", () => {
    expect(columns({ columns: 400 })).toBe(100);
    expect(columns({ columns: 10 })).toBe(40);
  });
});

describe("wrapping text to a width", () => {
  it("leaves short text alone", () => {
    expect(wrap("a short line", 40)).toEqual(["a short line"]);
  });

  it("breaks on words at the width", () => {
    expect(wrap("aaa bbb ccc ddd", 7)).toEqual(["aaa bbb", "ccc ddd"]);
  });

  it("hard-breaks a word longer than the width", () => {
    // A URL or a long identifier, which would otherwise run off the edge —
    // the exact ragged overflow this module exists to remove.
    expect(wrap("xxxxxxxxxx", 4)).toEqual(["xxxx", "xxxx", "xx"]);
  });

  it("keeps every line within the width", () => {
    const text = "the quick brown fox jumps over the lazy dog and keeps on going";
    for (const line of wrap(text, 12)) expect(line.length).toBeLessThanOrEqual(12);
  });

  it("keeps explicit newlines as their own lines", () => {
    expect(wrap("one\ntwo", 40)).toEqual(["one", "two"]);
  });
});
