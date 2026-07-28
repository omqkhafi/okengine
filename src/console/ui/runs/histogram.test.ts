/**
 * Duration distribution tests (console §9.11).
 */

import { describe, expect, test } from "bun:test";
import { runsOutlierFixture } from "./fixture.ts";
import { durationHistogram, inDurationRange, normalizeRange } from "./histogram.ts";

describe("duration histogram", () => {
  test("buckets cover the population", () => {
    const runs = runsOutlierFixture();
    const buckets = durationHistogram(runs, 10);
    expect(buckets.length).toBe(10);
    const total = buckets.reduce((a, b) => a + b.count, 0);
    expect(total).toBe(runs.length);
  });

  test("range helpers", () => {
    expect(normalizeRange(2000, 40)).toEqual({ minMs: 40, maxMs: 2000 });
    expect(inDurationRange({ durationMs: 2000 } as never, { minMs: 1000, maxMs: 3000 })).toBe(true);
  });
});
