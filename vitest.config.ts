import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Sync/scale tests touch real temp directories and mtimes; keep them serial
    // so wall-clock assertions in the scale harness are not fighting for I/O.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    /**
     * `default` keeps the usual console output; the second one writes
     * `docs/design/behaviours.md` from the run that just happened.
     *
     * A reporter rather than a separate script, so the index is rewritten by the
     * command everyone already runs and cannot fall behind the suite. It writes
     * nothing when the run was filtered to a subset — see `reporter.ts`.
     */
    reporters: ["default", new (await import("./src/behaviours/reporter.js")).default()],
  },
});
