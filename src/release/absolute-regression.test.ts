/**
 * Absolute budgets with room under the cap also fail at 2× the last value.
 */

import { describe, expect, test } from "bun:test";
import {
  absoluteBudgetOk,
  absoluteRegressionCeiling,
  formatBudgetsReport,
  type BudgetsSnapshot,
} from "./measure.ts";
import {
  ABSOLUTE_REGRESSION_RATIO,
  CLIENT_BUDGET_BYTES,
  COLD_START_BUDGET_MS,
  CONSOLE_BUDGET_BYTES,
  KERNEL_EDGE_BUDGET_BYTES,
} from "./limits.ts";

describe("absolute regression ceilings", () => {
  test("ratio is 2× so a confirmed doubling fails and a single noisy run can be re-measured", () => {
    expect(ABSOLUTE_REGRESSION_RATIO).toBe(2);
  });

  test("cold start and console initial load grow a ceiling; kernel, client, and a zero baseline do not", () => {
    expect(absoluteRegressionCeiling(undefined, COLD_START_BUDGET_MS, "ms")).toBeUndefined();
    expect(absoluteRegressionCeiling(0, 1, "ms")).toBeUndefined();
    expect(absoluteRegressionCeiling(8.915, COLD_START_BUDGET_MS, "ms")).toBe(17.83);
    expect(absoluteRegressionCeiling(353_621, CONSOLE_BUDGET_BYTES, "bytes")).toBe(707_242);
    expect(absoluteRegressionCeiling(12_556, KERNEL_EDGE_BUDGET_BYTES, "bytes")).toBeUndefined();
    expect(absoluteRegressionCeiling(4598, CLIENT_BUDGET_BYTES, "bytes")).toBeUndefined();
  });

  test("ok requires both the cap and the ceiling", () => {
    expect(absoluteBudgetOk(8.915, COLD_START_BUDGET_MS, 17.83)).toBe(true);
    expect(absoluteBudgetOk(17.83, COLD_START_BUDGET_MS, 17.83)).toBe(false);
    expect(absoluteBudgetOk(20, COLD_START_BUDGET_MS, 17.83)).toBe(false);
    expect(absoluteBudgetOk(80, COLD_START_BUDGET_MS, undefined)).toBe(false);
    expect(absoluteBudgetOk(12_556, KERNEL_EDGE_BUDGET_BYTES, undefined)).toBe(true);
  });

  test("the CI log prints the 2× ceiling and the absolute cap", () => {
    const snapshot: BudgetsSnapshot = {
      measuredAt: "2026-09-23T00:00:00.000Z",
      version: "0.0.0",
      budgets: [
        {
          id: "coldStartMedianMs",
          label: "Cold start on Bun",
          value: 20,
          limit: COLD_START_BUDGET_MS,
          regressionLimit: 17.83,
          unit: "ms",
          gate: "absolute",
          group: "core",
          ok: false,
        },
      ],
    };
    const report = formatBudgetsReport(snapshot);
    expect(report).toContain("[FAIL] Cold start on Bun: 20.000 ms < 17.830 ms (cap 75.000 ms)");
  });
});
