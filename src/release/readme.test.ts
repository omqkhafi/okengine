/**
 * Generated budgets markdown document.
 */

import { describe, expect, test } from "bun:test";
import { formatBudgetsMarkdown, type BudgetsSnapshot } from "./measure.ts";
import { BUDGETS_MD } from "./readme.ts";

describe("budgets markdown", () => {
  test("BUDGETS_MD points at root BUDGETS.md", () => {
    expect(BUDGETS_MD.endsWith("/BUDGETS.md")).toBe(true);
  });

  test("formatBudgetsMarkdown is a standalone document with short names", () => {
    const snapshot: BudgetsSnapshot = {
      measuredAt: "2026-07-25T00:00:00.000Z",
      version: "0.1.6",
      budgets: [
        {
          id: "kernelEdgeGzipBytes",
          label: "Kernel (edge profile)",
          value: 8969,
          limit: 15360,
          unit: "bytes",
          gate: "absolute",
          group: "core",
          ok: true,
        },
        {
          id: "export:./channel",
          label: "channel",
          value: 6144,
          limit: 6400,
          unit: "bytes",
          gate: "regression",
          group: "exports",
          ok: true,
        },
        {
          id: "export:./drivers/postgres",
          label: "postgres",
          value: 1413,
          limit: 1669,
          unit: "bytes",
          gate: "regression",
          group: "drivers",
          ok: true,
        },
      ],
    };
    const md = formatBudgetsMarkdown(snapshot);
    expect(md.startsWith("# Budgets\n")).toBe(true);
    expect(md).toContain("## Core");
    expect(md).toContain("## Exports");
    expect(md).toContain("## Drivers");
    expect(md).toContain("| channel |");
    expect(md).toContain("| postgres |");
    expect(md).toContain("[`budgets.json`](budgets.json)");
    expect(md).not.toContain("./channel");
  });
});
