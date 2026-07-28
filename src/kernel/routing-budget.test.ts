/**
 * p99 routing overhead budget — AGENTS.md / unified-theory §24.
 * Limit: < 1 ms per match on a compiled RegExp router.
 */

import { describe, expect, test } from "bun:test";
import { ROUTING_P99_BUDGET_MS } from "../release/limits.ts";
import { measureRoutingP99Ms } from "../release/measure.ts";

describe("routing overhead budget", () => {
  test(`p99 match < ${ROUTING_P99_BUDGET_MS} ms`, () => {
    const p99 = measureRoutingP99Ms();
    console.log(`routing p99=${p99.toFixed(4)} ms budget=${ROUTING_P99_BUDGET_MS}`);
    expect(p99).toBeGreaterThanOrEqual(0);
    expect(p99).toBeLessThan(ROUTING_P99_BUDGET_MS);
  });
});
