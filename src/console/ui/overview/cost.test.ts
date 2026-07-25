/**
 * Cost budgets — same model as error budgets (console §9.16).
 */

import { describe, expect, test } from "bun:test";
import { computeCostBudgets } from "./cost.ts";
import {
  OVERVIEW_BURN_RUNS,
  OVERVIEW_INPUTS_FIXTURE,
  OVERVIEW_MANIFEST,
  OVERVIEW_NOW,
} from "./fixture.ts";

describe("computeCostBudgets", () => {
  test("reads declared flow budget and real Runs spend", () => {
    const budgets = computeCostBudgets({
      manifest: OVERVIEW_MANIFEST,
      ai: OVERVIEW_INPUTS_FIXTURE.ai,
      runs: OVERVIEW_BURN_RUNS,
      now: OVERVIEW_NOW,
    });
    const flow = budgets.find((b) => b.id === "flow:bookings.create");
    expect(flow).toBeDefined();
    expect(flow!.declaredBudget).toBe(10);
    // 100 runs × $0.05 = $5
    expect(flow!.spent).toBeCloseTo(5, 5);
    expect(flow!.burnRate).toBeCloseTo(0.5, 5);
  });

  test("includes AI prompt budgets from panel metrics", () => {
    const budgets = computeCostBudgets({
      manifest: OVERVIEW_MANIFEST,
      ai: OVERVIEW_INPUTS_FIXTURE.ai,
      runs: OVERVIEW_BURN_RUNS,
      now: OVERVIEW_NOW,
    });
    expect(budgets.some((b) => b.kind === "ai-prompt")).toBe(true);
  });
});
