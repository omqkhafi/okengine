/**
 * Manifest Diff grouping / CI gate copy (console §9.12).
 */

import { describe, expect, test } from "bun:test";
import { DIFF_LIST_FIXTURE } from "./fixture.ts";
import { filterChanges, formatCiGate, groupByCategory } from "./group.ts";

describe("groupByCategory", () => {
  test("keeps the four blast-radius sections in order", () => {
    const groups = groupByCategory(DIFF_LIST_FIXTURE.changes);
    expect(groups.map((g) => g.category)).toEqual([
      "contract-breaking",
      "permission-widening",
      "effect-widening",
      "no-impact",
    ]);
  });

  test("does not invent categories — only renders projection output", () => {
    const only = DIFF_LIST_FIXTURE.changes.filter((c) => c.category === "effect-widening");
    const groups = groupByCategory(only);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.category).toBe("effect-widening");
    expect(groups[0]!.items[0]!.blastLine).toContain("41,208");
  });
});

describe("filterChanges", () => {
  test("filters by path and blast line without reclassifying", () => {
    const hits = filterChanges(DIFF_LIST_FIXTURE.changes, "email");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.category).toBe("effect-widening");
  });

  test("category facet narrows without changing category labels", () => {
    const hits = filterChanges(DIFF_LIST_FIXTURE.changes, "", "contract-breaking");
    expect(hits.every((c) => c.category === "contract-breaking")).toBe(true);
  });
});

describe("formatCiGate", () => {
  test("undeclared break is blocked; breaking: true is allowed through", () => {
    expect(formatCiGate("blocked")).toContain("blocked");
    expect(formatCiGate("acknowledged")).toContain("breaking: true");
    expect(formatCiGate(null)).toBeNull();
  });
});
