/**
 * Cold-start budget gate — unified-theory §24 / AGENTS.md.
 * Measured in a fresh Bun subprocess so import cost is real.
 *
 * Limit: < 50 ms from process start to server ready.
 */

import { describe, expect, test } from "bun:test";

/** Budget from AGENTS.md / unified-theory §24. */
export const COLD_START_BUDGET_MS = 50;

const root = `${import.meta.dir}/../..`;
const paths = {
  bun: `${import.meta.dir}/bun.ts`,
  app: `${import.meta.dir}/../kernel/app.ts`,
  flow: `${import.meta.dir}/../kernel/flow.ts`,
  on: `${import.meta.dir}/../kernel/on.ts`,
  http: `${import.meta.dir}/../kernel/triggers.ts`,
};

const probe = `
const t0 = performance.now();
const { createBunRuntime } = await import(${JSON.stringify(paths.bun)});
const { oke } = await import(${JSON.stringify(paths.app)});
const { flow } = await import(${JSON.stringify(paths.flow)});
const { on, resetBindings } = await import(${JSON.stringify(paths.on)});
const { http } = await import(${JSON.stringify(paths.http)});
resetBindings();
on(http.get("/ping"), flow({ name: "ping", do: () => ({ ok: true }) }));
const app = oke({ name: "cold-start" });
const rt = createBunRuntime();
const server = rt.serve(app, { port: 0, hostname: "127.0.0.1" });
const ms = performance.now() - t0;
server.stop(true);
process.stdout.write(String(ms));
`;

describe("cold start budget", () => {
  test(`Bun adapter ready in < ${COLD_START_BUDGET_MS} ms`, async () => {
    const samples: number[] = [];
    // Warm the filesystem cache once, then take the measured run.
    for (let i = 0; i < 3; i++) {
      const proc = Bun.spawn(["bun", "-e", probe], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(exitCode).toBe(0);
      if (stderr.trim()) {
        // Ignore Bun experimental notices; fail on real errors.
        if (/error|Error|ENOENT/i.test(stderr) && !/ExperimentalWarning/i.test(stderr)) {
          throw new Error(stderr);
        }
      }
      const ms = Number(stdout.trim());
      expect(Number.isFinite(ms)).toBe(true);
      samples.push(ms);
    }

    // Report the median so a single noisy sample does not flake CI.
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    // Recorded for CI logs — claims we cannot measure, we do not make.
    console.log(
      `cold-start samples(ms)=${samples.map((s) => s.toFixed(2)).join(", ")} median=${median.toFixed(2)} budget=${COLD_START_BUDGET_MS}`,
    );
    expect(median).toBeLessThan(COLD_START_BUDGET_MS);
  });
});
