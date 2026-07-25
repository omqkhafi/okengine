/**
 * Promotion gate tests (console §9.10).
 */

import { describe, expect, test } from "bun:test";
import { VERSION_V2, VERSION_V3 } from "./fixture.ts";
import {
  formatPromotionBlockers,
  promotionDecision,
} from "./promotion.ts";
import type { PromptVersionMetrics } from "./types.ts";

function withRates(
  base: PromptVersionMetrics,
  patch: Partial<PromptVersionMetrics>,
): PromptVersionMetrics {
  return { ...base, ...patch };
}

describe("promotionDecision", () => {
  test("blocks when schema-invalid rises even if eval improves", () => {
    const decision = promotionDecision(VERSION_V2, VERSION_V3);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.blockers).toContain("schema_validity");
    expect(decision.blockers).toContain("budget");
    expect(decision.evalImproved).toBe(true);
    expect(decision.numbers.toSchemaInvalidRate).toBe(0.086);
    expect(decision.numbers.fromSchemaInvalidRate).toBe(0.02);
    const lines = formatPromotionBlockers(decision);
    expect(lines.some((l) => l.includes("schema-invalid"))).toBe(true);
    expect(lines.some((l) => l.includes("improved — still blocked"))).toBe(
      true,
    );
  });

  test("allows when schema and budget do not regress", () => {
    const better = withRates(VERSION_V3, {
      version: 4,
      schemaInvalidRate: 0.01,
      overBudgetRate: 0,
      cost: {
        ...VERSION_V3.cost,
        p95: 0.015,
        mean: 0.01,
      },
      evalScore: {
        ...VERSION_V3.evalScore,
        mean: 0.95,
      },
    });
    const decision = promotionDecision(VERSION_V2, better);
    expect(decision.allowed).toBe(true);
    expect(decision.evalImproved).toBe(true);
  });

  test("blocks budget when p95 crosses maxCostPerCall", () => {
    const candidate = withRates(VERSION_V2, {
      version: 5,
      schemaInvalidRate: 0.02,
      overBudgetRate: 0,
      cost: {
        ...VERSION_V2.cost,
        p95: 0.05,
        mean: 0.03,
      },
      evalScore: {
        ...VERSION_V2.evalScore,
        mean: 0.99,
      },
    });
    const decision = promotionDecision(VERSION_V2, candidate);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.blockers).toEqual(["budget"]);
  });
});
