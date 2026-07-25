/**
 * Kernel edge profile budget — AGENTS.md / unified-theory §24.
 * Limit: < 15 kB gzipped (minified bundle).
 */

import { describe, expect, test } from "bun:test";
import { KERNEL_EDGE_BUDGET_BYTES } from "../release/limits.ts";
import { measureKernelEdgeGzipBytes } from "../release/measure.ts";

describe("kernel edge bundle budget", () => {
  test(`edge profile < ${KERNEL_EDGE_BUDGET_BYTES} bytes gzipped`, async () => {
    const size = await measureKernelEdgeGzipBytes();
    console.log(
      `kernel edge gzip=${size} budget=${KERNEL_EDGE_BUDGET_BYTES}`,
    );
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(KERNEL_EDGE_BUDGET_BYTES);
  });
});
