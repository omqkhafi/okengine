/**
 * Console initial bundle budget — < 300 kB gzipped (console §7).
 *
 * Reports a definitive initial-vs-lazy breakdown so the Prompt 21 vs Runs
 * measurement gap cannot recur as an unexplained number.
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
    console.log(
      "lazy panel chunks:\n" +
        breakdown.panels
          .map((a) => `  ${a.name}: ${a.gzip} (${(a.gzip / 1024).toFixed(2)} kB)`)
          .join("\n"),
    );
    if (breakdown.other.length > 0) {
      console.log(
        "other (not initial, not panel-*):\n" +
          breakdown.other
            .map(
              (a) =>
                `  ${a.name}: ${a.gzip} (${(a.gzip / 1024).toFixed(2)} kB)`,
            )
            .join("\n"),
      );
    }
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(CONSOLE_BUDGET_BYTES);
    // All 15 feature panels (+ shell) must land as named lazy chunks.
    const panelIds = breakdown.panels.flatMap((p) => {
      const m = /^panel-([a-z]+)-/.exec(p.name);
      return m?.[1] ? [m[1]] : [];
    });
    for (const id of [
      "overview",
      "flows",
      "traces",
      "runs",
      "signals",
      "store",
      "clock",
      "vault",
      "ai",
      "channels",
      "gates",
      "diff",
      "architecture",
      "access",
      "plugins",
    ]) {
      expect(panelIds).toContain(id);
    }
    // No panel chunk may be pulled into the initial navigation set.
    for (const asset of breakdown.initial) {
      expect(asset.name.includes("panel-")).toBe(false);
    }
  });
});
