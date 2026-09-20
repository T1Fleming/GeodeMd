import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { inspectFolder, proposeConfig } from "./setup.js";
import { initConfig, writeConfig } from "./config.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "geode-setup-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const write = async (rel: string, text = "q :: a\n"): Promise<void> => {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await fs.writeFile(path.join(dir, rel), text);
};

describe("inspectFolder", () => {
  it("counts the markdown files a sync would actually read", async () => {
    await write("aws/lambda.md");
    await write("sqlite/wal.md");
    await write("notes.txt");
    const r = await inspectFolder(dir);
    expect(r).toMatchObject({ exists: true, isDirectory: true, markdownFiles: 2 });
  });

  it("counts the same way enumerate does, dotted directories included", async () => {
    // A second walk would drift, and the drift would look like a miscount:
    // `.git` holds markdown in its own right, and `.sr/` is ours.
    await write("real.md");
    await write(".git/README.md");
    await write(".sr/log/notes.md");
    expect((await inspectFolder(dir)).markdownFiles).toBe(1);
  });

  it("reports an empty folder rather than refusing it", async () => {
    // Starting a collection from nothing is a legitimate first run; the count
    // is a signal to show the user, not a gate.
    const r = await inspectFolder(dir);
    expect(r).toMatchObject({ exists: true, isDirectory: true, markdownFiles: 0 });
  });

  it("notices a git repository, because that changes which warning is honest", async () => {
    await fs.mkdir(path.join(dir, ".git"));
    expect((await inspectFolder(dir)).isGitRepo).toBe(true);
    expect((await inspectFolder(path.join(dir, "..", path.basename(dir)))).isGitRepo).toBe(true);
  });

  it("says so when the path is gone", async () => {
    const r = await inspectFolder(path.join(dir, "nope"));
    expect(r).toMatchObject({ exists: false, isDirectory: false });
  });

  it("tells a file apart from a missing path", async () => {
    // Picking a file is a different mistake from picking nothing, and the
    // repair screen says something different for each.
    await write("a.md");
    const r = await inspectFolder(path.join(dir, "a.md"));
    expect(r).toMatchObject({ exists: true, isDirectory: false });
  });

  it("resolves the path it reports back", async () => {
    const r = await inspectFolder(path.join(dir, "aws", ".."));
    expect(r.path).toBe(path.resolve(dir));
  });
});

describe("proposeConfig", () => {
  const configFile = (): string => path.join(dir, "config.json");

  it("proposes a fresh device and the default db path on a first run", async () => {
    const p = await proposeConfig(configFile(), path.join(dir, "notes"), {
      XDG_DATA_HOME: path.join(dir, "data"),
    } as NodeJS.ProcessEnv);
    expect(p.replaces).toBeNull();
    expect(p.preserved).toEqual([]);
    expect(p.device).toMatch(/-[a-z0-9]{4}$/);
    expect(p.dbPath).toBe(path.join(dir, "data", "geodemd", "db.sqlite"));
  });

  it("keeps the device when there is already a config, and says that it did", async () => {
    // The preservation is already correct in initConfig. What is missing
    // without this is the app being able to TELL the user — and a GUI that
    // silently keeps a field looks like it ignored the question.
    await initConfig(configFile(), path.join(dir, "old"));
    const before = await proposeConfig(configFile(), path.join(dir, "new"));
    expect(before.replaces?.notesPath).toBe(path.join(dir, "old"));
    expect(before.preserved).toContain("device");
    expect(before.device).toBe(before.replaces!.device);
  });

  it("mentions editor only when there is one to keep", async () => {
    await initConfig(configFile(), path.join(dir, "old"));
    expect((await proposeConfig(configFile(), dir)).preserved).toEqual(["device"]);

    const existing = (await proposeConfig(configFile(), dir)).replaces!;
    await writeConfig(configFile(), { ...existing, editor: "nvim" });
    expect((await proposeConfig(configFile(), dir)).preserved).toEqual(["device", "editor"]);
  });

  it("writes nothing", async () => {
    await proposeConfig(configFile(), path.join(dir, "notes"));
    await expect(fs.stat(configFile())).rejects.toThrow();
  });

  it("resolves a relative notesPath, as init would", async () => {
    const p = await proposeConfig(configFile(), path.join(dir, "notes", "..", "notes"));
    expect(p.notesPath).toBe(path.join(dir, "notes"));
  });
});

describe("telling a moved folder from a first run", () => {
  it("is a question inspectFolder answers, so the two get different screens", async () => {
    // Both reach the app as "no usable collection". One needs onboarding, the
    // other needs the path repointed and nothing else — and the repair screen
    // wants the rest of the report anyway, to confirm the new folder.
    expect(await inspectFolder(path.join(dir, "unmounted"))).toMatchObject({ exists: false });
    expect(await inspectFolder(dir)).toMatchObject({ exists: true, isDirectory: true });
  });
});
