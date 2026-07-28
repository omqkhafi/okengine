/**
 * Automatic promotion gate between prompt versions (console §9.10).
 *
 * A version can score higher on evals and still be blocked when schema
 * validity or budget would regress. Numbers are read from metrics — never
 * hand-waved.
 */

import type { PromptVersionMetrics } from "./types.ts";

/** Why promotion is blocked. */
export type PromotionBlocker = "budget" | "schema_validity";

/** Promotion decision with the real numbers that drove it. */
export type PromotionDecision =
  | {
      readonly allowed: true;
      readonly from: PromptVersionMetrics;
      readonly to: PromptVersionMetrics;
      readonly evalImproved: boolean;
      readonly numbers: PromotionNumbers;
    }
  | {
      readonly allowed: false;
      readonly from: PromptVersionMetrics;
      readonly to: PromptVersionMetrics;
      readonly blockers: readonly PromotionBlocker[];
      readonly evalImproved: boolean;
      readonly numbers: PromotionNumbers;
    };

/** Concrete rates / costs compared. */
export interface PromotionNumbers {
  readonly fromEvalMean: number;
  readonly toEvalMean: number;
  readonly fromSchemaInvalidRate: number;
  readonly toSchemaInvalidRate: number;
  readonly fromOverBudgetRate: number;
  readonly toOverBudgetRate: number;
  readonly fromP95Cost: number;
  readonly toP95Cost: number;
  readonly budgetMaxCostPerCall: number | null;
}

/**
 * Decide whether promoting `to` over `from` is allowed.
 *
 * Blocked when schema-invalid rate rises or budget adherence regresses,
 * even if eval score improves.
 *
 * @param from - Current / baseline version metrics
 * @param to - Candidate version metrics
 */
export function promotionDecision(
  from: PromptVersionMetrics,
  to: PromptVersionMetrics,
): PromotionDecision {
  if (from.prompt !== to.prompt) {
    throw new Error(`promotionDecision: prompt mismatch (${from.prompt} vs ${to.prompt})`);
  }

  const numbers: PromotionNumbers = {
    fromEvalMean: from.evalScore.mean,
    toEvalMean: to.evalScore.mean,
    fromSchemaInvalidRate: from.schemaInvalidRate,
    toSchemaInvalidRate: to.schemaInvalidRate,
    fromOverBudgetRate: from.overBudgetRate,
    toOverBudgetRate: to.overBudgetRate,
    fromP95Cost: from.cost.p95,
    toP95Cost: to.cost.p95,
    budgetMaxCostPerCall: to.budgetMaxCostPerCall ?? from.budgetMaxCostPerCall,
  };

  const blockers: PromotionBlocker[] = [];

  // Schema validity regresses when the invalid rate rises.
  if (to.schemaInvalidRate > from.schemaInvalidRate + 1e-12) {
    blockers.push("schema_validity");
  }

  // Budget regresses when over-budget rate rises, or p95 crosses the budget
  // while the baseline stayed under.
  const budget = numbers.budgetMaxCostPerCall;
  if (to.overBudgetRate > from.overBudgetRate + 1e-12) {
    blockers.push("budget");
  } else if (budget !== null && to.cost.p95 > budget && from.cost.p95 <= budget) {
    blockers.push("budget");
  }

  const evalImproved = to.evalScore.mean > from.evalScore.mean + 1e-12;

  if (blockers.length > 0) {
    return {
      allowed: false,
      from,
      to,
      blockers,
      evalImproved,
      numbers,
    };
  }

  return {
    allowed: true,
    from,
    to,
    evalImproved,
    numbers,
  };
}

/**
 * Format a blocked promotion for the operator (real numbers, no fluff).
 *
 * @param decision - Blocked decision
 */
export function formatPromotionBlockers(
  decision: Extract<PromotionDecision, { allowed: false }>,
): readonly string[] {
  const lines: string[] = [];
  const n = decision.numbers;
  if (decision.blockers.includes("schema_validity")) {
    lines.push(
      `schema-invalid ${(n.fromSchemaInvalidRate * 100).toFixed(1)}% → ${(n.toSchemaInvalidRate * 100).toFixed(1)}%`,
    );
  }
  if (decision.blockers.includes("budget")) {
    const budget =
      n.budgetMaxCostPerCall !== null ? `budget $${n.budgetMaxCostPerCall.toFixed(4)}` : "budget";
    lines.push(
      `over-budget ${(n.fromOverBudgetRate * 100).toFixed(1)}% → ${(n.toOverBudgetRate * 100).toFixed(1)}%` +
        ` · p95 $${n.fromP95Cost.toFixed(4)} → $${n.toP95Cost.toFixed(4)} (${budget})`,
    );
  }
  if (decision.evalImproved) {
    lines.push(
      `eval mean ${(n.fromEvalMean * 100).toFixed(1)}% → ${(n.toEvalMean * 100).toFixed(1)}% (improved — still blocked)`,
    );
  }
  return lines;
}
