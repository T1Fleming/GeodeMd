/**
 * The enumeration measurement `docs/design/testing.md` reserves as "deliberately
 * not automated" — it decides an open question rather than guarding an
 * invariant, so it is opt-in and asserts almost nothing.
 *
 *   GEODE_BENCH=1 npx vitest run src/files/enumerate.bench.test.ts
 *
 *   GEODE_BENCH_FILES=80000   total files per shape (default 20000)
 *   GEODE_BENCH_TREE=/path    reuse a prebuilt tree instead of making one
 *
 * All three strategies run in ONE process against the SAME tree, because the
 * numbers in the issue came from a different machine on a different day and
 * that is exactly how a benchmark misleads.
 *
 * Two tree shapes on purpose. A wide tree (100 files per directory) is what
 * `scale.test.ts` builds; a narrow one (4 per directory) is what a real notes folder
 * of topic folders looks like, and it is where per-directory parallelism —
 * the obvious design — collapses to no concurrency at all.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { enumerate } from "./index.js";

const ENABLED = process.env.GEODE_BENCH === "1";
const TOTAL = Number(process.env.GEODE_BENCH_FILES ?? 20_000);
const RUNS = 5;

interface Found {
  relPath: string;
  mtimeMs: number;
  size: number;
}

/** Today's shipped shape: one awaited stat per file, inline in the loop. */
async function sequential(root: string): Promise<Found[]> {
  const out: Found[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!e.name.startsWith(".")) await walk(abs, childRel);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const st = await fs.stat(abs);
      out.push({ relPath: childRel, mtimeMs: st.mtimeMs, size: st.size });
    }
  }
  await walk(root, "");
  return out;
}

/** Walk first, then fill through a bounded pool. */
async function pooled(root: string, limit: number): Promise<Found[]> {
  const out: Found[] = [];
  const abs: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!e.name.startsWith(".")) await walk(full, childRel);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      out.push({ relPath: childRel, mtimeMs: 0, size: 0 });
      abs.push(full);
    }
  }
  await walk(root, "");

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < abs.length) {
      const i = next++;
      const st = await fs.stat(abs[i]!);
      out[i]!.mtimeMs = st.mtimeMs;
      out[i]!.size = st.size;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, abs.length) }, () => worker()));
  return out;
}

/** Blocking, and the fastest row in the issue's table. */
function sync(root: string): Found[] {
  const out: Found[] = [];
  function walk(dir: string, rel: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!e.name.startsWith(".")) walk(abs, childRel);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const st = statSync(abs);
      out.push({ relPath: childRel, mtimeMs: st.mtimeMs, size: st.size });
    }
  }
  walk(root, "");
  return out;
}

async function makeTree(total: number, perDir: number): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "geode-bench-"));
  const dirs = Math.ceil(total / perDir);
  for (let d = 0; d < dirs; d++) {
    const dir = path.join(root, `d${d}`);
    await fs.mkdir(dir, { recursive: true });
    const n = Math.min(perDir, total - d * perDir);
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        fs.writeFile(path.join(dir, `n${i}.md`), `Q${d}_${i} :: A${d}_${i}\n`, "utf8"),
      ),
    );
  }
  return root;
}

/** Median of `RUNS`, after a discarded warm-up. One cache miss skews a mean. */
async function medianMs(fn: () => Promise<unknown> | unknown): Promise<number> {
  await fn();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

describe.skipIf(!ENABLED)("enumeration strategies", () => {
  for (const [shape, perDir] of [
    ["wide (100/dir)", 100],
    ["narrow (4/dir)", 4],
  ] as const) {
    it(
      `${shape} — ${TOTAL} files`,
      async () => {
        const root = process.env.GEODE_BENCH_TREE ?? (await makeTree(TOTAL, perDir));
        try {
          const seqN = (await sequential(root)).length;
          const seq = await medianMs(() => sequential(root));
          const pool = await medianMs(() => pooled(root, 64));
          const blocking = await medianMs(() => sync(root));
          const real = await medianMs(() => enumerate(root));

          const per = (ms: number) => ((ms * 1000) / seqN).toFixed(2);
          console.log(
            `\n  ${shape}  n=${seqN}  node ${process.version}\n` +
              `    sequential await  ${seq.toFixed(1).padStart(8)} ms   ${per(seq)} µs/file   (the old shape)\n` +
              `    pooled(64)        ${pool.toFixed(1).padStart(8)} ms   ${per(pool)} µs/file   ${(seq / pool).toFixed(2)}x\n` +
              `    statSync          ${blocking.toFixed(1).padStart(8)} ms   ${per(blocking)} µs/file   ${(seq / blocking).toFixed(2)}x  (rejected: ADR 0013)\n` +
              `    enumerate()       ${real.toFixed(1).padStart(8)} ms   ${per(real)} µs/file   ${(seq / real).toFixed(2)}x  <- shipped\n`,
          );

          // The shipped function must agree with the old shape exactly. A
          // faster walk that reorders re-mints the wrong duplicate.
          expect((await enumerate(root)).candidates.map((c) => c.relPath)).toEqual(
            (await sequential(root)).map((c) => c.relPath),
          );
          expect(real).toBeLessThanOrEqual(seq * 1.2);
        } finally {
          if (!process.env.GEODE_BENCH_TREE) await fs.rm(root, { recursive: true, force: true });
        }
      },
      10 * 60_000,
    );
  }
});
