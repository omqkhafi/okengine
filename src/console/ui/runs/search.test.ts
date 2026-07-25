/**
 * Runs URL search state tests (console §9.11).
 */

import { describe, expect, test } from "bun:test";
import {
  dimensionQueryOf,
  durationRangeOf,
  parseRunsSearch,
  serializeRunsSearch,
  setDurationRange,
  setWhere,
} from "./search.ts";
import { parseDimensionQuery } from "./query.ts";

describe("runs search", () => {
  test("round-trips where + group + brush + run", () => {
    const search = parseRunsSearch({
      where: "cache = miss AND duration > 1s",
      group: "tenant",
      run: "run_1",
      durMin: "1000",
      durMax: "5000",
    });
    expect(dimensionQueryOf(search).clauses).toHaveLength(2);
    expect(durationRangeOf(search)).toEqual({ minMs: 1000, maxMs: 5000 });
    expect(serializeRunsSearch(search)).toEqual({
      where: "cache = miss AND duration > 1s",
      group: "tenant",
      run: "run_1",
      durMin: 1000,
      durMax: 5000,
    });
  });

  test("setWhere / setDurationRange helpers", () => {
    let s = parseRunsSearch({});
    s = setWhere(s, parseDimensionQuery("flow = book"));
    s = setDurationRange(s, { minMs: 10, maxMs: 20 });
    expect(s.where).toBe("flow = book");
    expect(s.durMin).toBe(10);
    s = setDurationRange(s, null);
    expect(s.durMin).toBeUndefined();
  });
});
