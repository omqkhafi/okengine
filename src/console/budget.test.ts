/**
 * Console initial bundle budget — gzipped html + entry js/css.
 *
 * ui-next is a single SPA (no legacy `panel-*` split). The cap is the
 * first-navigation download, not a panel-chunk inventory.
 */

import { describe, expect, test } from "bun:test";
import { CONSOLE_BUDGET_BYTES } from "../release/limits.ts";
import { measureConsoleBundleBreakdown } from "../release/measure.ts";

describe("console bundle budget", () => {
  test(`initial load < ${CONSOLE_BUDGET_BYTES} bytes gzipped`, async () => {
    const breakdown = await measureConsoleBundleBreakdown();
    const size = breakdown.initialGzipBytes;
    console.log(
      `console initial gzip=${size} (${(size / 1024).toFixed(2)} kB) budget=${CONSOLE_BUDGET_BYTES}`,
    );
    console.log(
      "initial assets:\n" +
        breakdown.initial
          .map((a) => `  ${a.name}: ${a.gzip} (${(a.gzip / 1024).toFixed(2)} kB)`)
          .join("\n"),
    );
    if (breakdown.panels.length > 0) {
      console.log(
        "lazy chunks:\n" +
          breakdown.panels
            .map((a) => `  ${a.name}: ${a.gzip} (${(a.gzip / 1024).toFixed(2)} kB)`)
            .join("\n"),
      );
    }
    if (breakdown.other.length > 0) {
      console.log(
        "other (not initial):\n" +
          breakdown.other
            .map((a) => `  ${a.name}: ${a.gzip} (${(a.gzip / 1024).toFixed(2)} kB)`)
            .join("\n"),
      );
    }
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(CONSOLE_BUDGET_BYTES);
  });
});
