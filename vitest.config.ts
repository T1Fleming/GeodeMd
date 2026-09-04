import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Sync/scale tests touch real temp directories and mtimes; keep them serial
    // so wall-clock assertions in the scale harness are not fighting for I/O.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
  },
});
