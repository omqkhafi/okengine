/**
 * Model budget overrun findings for Overview aggregation (console §9.10 · §9.16).
 *
 * Detection is the AI panel's `overBudgetRate` metric — not recomputed here.
 */

import type { PromptVersionMetrics } from "./types.ts";

/** One over-budget prompt version from the AI panel. */
export interface OverBudgetFinding {
  readonly prompt: string;
  readonly version: number;
  readonly overBudgetRate: number;
  readonly budgetMaxCostPerCall: number | null;
  readonly p95Cost: number;
}

/**
 * Prompt versions whose projected metrics already report over-budget spend.
 *
 * @param versions - AI panel version metrics
 */
export function overBudgetFindings(
  versions: readonly PromptVersionMetrics[],
): readonly OverBudgetFinding[] {
  return versions
    .filter((v) => v.overBudgetRate > 0)
    .map((v) => ({
      prompt: v.prompt,
      version: v.version,
      overBudgetRate: v.overBudgetRate,
      budgetMaxCostPerCall: v.budgetMaxCostPerCall,
      p95Cost: v.cost.p95,
    }))
    .sort(
      (a, b) =>
        b.overBudgetRate - a.overBudgetRate ||
        a.prompt.localeCompare(b.prompt) ||
        b.version - a.version,
    );
}
