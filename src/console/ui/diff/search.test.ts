/**
 * Manifest Diff URL search tests (console §9.12).
 */

import { describe, expect, test } from "bun:test";
import { openDiffPath, parseDiffSearch, serializeDiffSearch } from "./search.ts";

describe("Diff search", () => {
  test("round-trips path + category", () => {
    const parsed = parseDiffSearch({
      path: "/flows/orders.notify/effects/sends",
      category: "effect-widening",
      q: "email",
    });
    expect(parsed.path).toBe("/flows/orders.notify/effects/sends");
    expect(parsed.category).toBe("effect-widening");
    expect(serializeDiffSearch(parsed)).toEqual({
      q: "email",
      path: "/flows/orders.notify/effects/sends",
      category: "effect-widening",
    });
  });

  test("openDiffPath focuses a change", () => {
    const next = openDiffPath({}, "/flows/reports.export/in");
    expect(next.path).toBe("/flows/reports.export/in");
  });
});
