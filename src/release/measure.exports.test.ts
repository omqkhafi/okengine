/**
 * Export gzip measurement + regression limit helpers.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  exportRegressionLimitBytes,
  formatBudgetsReport,
  measureExportGzipBytes,
  type BudgetsSnapshot,
} from "./measure.ts";
import {
  EXPORT_REGRESSION_TOLERANCE_FLOOR_BYTES,
  EXPORT_REGRESSION_TOLERANCE_RATIO,
} from "./limits.ts";

describe("export gzip budgets", () => {
  test("measureExportGzipBytes(./client) retains the runtime graph", async () => {
    const entry = resolve(import.meta.dir, "../client/index.ts");
    const size = await measureExportGzipBytes(entry);
    // Must not collapse to an empty re-export stub (~100 B).
    expect(size).toBeGreaterThan(1024);
  });

  test("exportRegressionLimitBytes uses max(floor, 2% of previous)", () => {
    expect(exportRegressionLimitBytes(1000)).toBe(1000 + EXPORT_REGRESSION_TOLERANCE_FLOOR_BYTES);
    const large = 100_000;
    expect(exportRegressionLimitBytes(large)).toBe(
      large + Math.ceil(large * EXPORT_REGRESSION_TOLERANCE_RATIO),
    );
  });

  test("formatBudgetsReport groups Core / Exports / Plugins / Drivers with short names", () => {
    const snapshot: BudgetsSnapshot = {
      measuredAt: "2026-07-25T00:00:00.000Z",
      version: "0.0.0",
      budgets: [
        {
          id: "kernelEdgeGzipBytes",
          label: "Kernel (edge profile)",
          value: 100,
          limit: 200,
          unit: "bytes",
          gate: "absolute",
          group: "core",
          ok: true,
        },
        {
          id: "export:./channel",
          label: "channel",
          value: 100,
          limit: 200,
          unit: "bytes",
          gate: "regression",
          group: "exports",
          ok: true,
        },
        {
          id: "export:./plugins/cors",
          label: "cors",
          value: 100,
          limit: 200,
          unit: "bytes",
          gate: "regression",
          group: "plugins",
          ok: true,
        },
        {
          id: "export:./drivers/postgres",
          label: "postgres",
          value: 100,
          limit: 200,
          unit: "bytes",
          gate: "regression",
          group: "drivers",
          ok: true,
        },
      ],
    };
    const report = formatBudgetsReport(snapshot);
    expect(report).toContain("\nCore\n");
    expect(report).toContain("\nExports\n");
    expect(report).toContain("\nPlugins\n");
    expect(report).toContain("\nDrivers\n");
    expect(report).toContain("[ok] channel:");
    expect(report).toContain("[ok] cors:");
    expect(report).toContain("[ok] postgres:");
    expect(report).not.toContain("regression Export");
    expect(report).not.toContain("./channel");
  });
});
