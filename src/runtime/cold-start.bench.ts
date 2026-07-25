/**
 * Cold-start budget gate — unified-theory §24 / AGENTS.md.
 * Measured in a fresh Bun subprocess so import cost is real.
 *
 * Limit: < 50 ms from process start to server ready.
 */

import { describe, expect, test } from "bun:test";
import { COLD_START_BUDGET_MS } from "../release/limits.ts";
import { measureColdStartMedianMs } from "../release/measure.ts";

describe("cold start budget", () => {
  test(`Bun adapter ready in < ${COLD_START_BUDGET_MS} ms`, async () => {
    const median = await measureColdStartMedianMs();
    console.log(
      `cold-start median=${median.toFixed(2)} ms budget=${COLD_START_BUDGET_MS}`,
    );
    expect(median).toBeLessThan(COLD_START_BUDGET_MS);
  });
});
