import { describe, expect, it } from "vitest";
import { openDetached } from "./open.js";

/**
 * Real spawns of harmless programs. Mocking `child_process` here would test
 * the mock: the three things that matter — that ENOENT is reported rather than
 * swallowed, that the call returns before the child exits, and that the app is
 * not held open by it — are all properties of the actual spawn.
 */
describe("launching an editor without holding the app open", () => {
  it("reports an editor that is not installed, rather than claiming success", async () => {
    // ENOENT arrives asynchronously, so a version that resolved immediately
    // would report `launched: true` for an editor nobody has.
    const r = await openDetached("/notes/a.md", 1, "geode-no-such-editor-xyz");
    expect(r.launched).toBe(false);
    expect(r.message).toContain("geode-no-such-editor-xyz");
    expect(r.message).toContain("Collection screen");
  });

  it("reports a launcher that vanished between the lookup and the spawn", async () => {
    // The lookup says yes and the spawn says ENOENT: still reported, not
    // claimed as a success.
    const r = await openDetached("/notes/a.md", 1, "/nowhere/geode-gone", {
      env: {},
      platform: process.platform,
      home: "/nowhere",
      isExecutable: () => true,
    });
    expect(r.launched).toBe(false);
    expect(r.message).toContain("could not run");
  });

  it("returns as soon as the process exists, not when it exits", async () => {
    // `sleep 5` stands in for a terminal editor sitting open. Awaiting the exit
    // is what the CLI does and is exactly wrong here: it would freeze the
    // review screen for as long as the note stays open.
    const started = Date.now();
    const r = await openDetached("/notes/a.md", null, "sleep 5");
    expect(r.launched).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("does not keep the event loop alive waiting for the child", async () => {
    // The unref is what lets the app quit while the editor is still open. If
    // this regresses, `npm test` hangs at the end of the file rather than
    // failing — which is why it is asserted directly.
    const before = process.getActiveResourcesInfo().length;
    await openDetached("/notes/a.md", null, "sleep 5");
    expect(process.getActiveResourcesInfo().length).toBeLessThanOrEqual(before + 1);
  });

  it("passes the line through the same table the CLI uses", async () => {
    // Not a second table: `editorCommand` is shared, so this asserts the wiring
    // rather than re-testing the editor families (see host/editor.test.ts).
    const r = await openDetached("/notes/a.md", 42, "true");
    expect(r.launched).toBe(true);
  });
});
