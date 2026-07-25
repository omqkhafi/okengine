/**
 * Console initial bundle budget — < 300 kB gzipped (console §7).
 */

import { describe, expect, test } from "bun:test";
import { CONSOLE_BUDGET_BYTES } from "../release/limits.ts";
import { measureConsoleInitialGzipBytes } from "../release/measure.ts";

describe("console bundle budget", () => {
  test(`initial load < ${CONSOLE_BUDGET_BYTES} bytes gzipped`, async () => {
    const size = await measureConsoleInitialGzipBytes();
    console.log(
      `console initial gzip=${size} budget=${CONSOLE_BUDGET_BYTES}`,
    );
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(CONSOLE_BUDGET_BYTES);
  });
});
