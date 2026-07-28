/**
 * Overview panel pure modules (console §9.16).
 */

export type {
  CostBudget,
  FindingSource,
  FirstSloInvite,
  GoldenSignals,
  OverviewFinding,
  OverviewVerdict,
  OverviewView,
  SloBurn,
  WhatChanged,
} from "./types.ts";

export { composeOverview, type OverviewInputs } from "./compose.ts";

export {
  declaredSlos,
  computeSloBurns,
  hasDeclaredSlos,
  parseAvailability,
  BURN_SHORT_WINDOW_MS,
  BURN_LONG_WINDOW_MS,
  CEREMONIAL_LOOKBACK_MS,
} from "./slo.ts";

export { computeCostBudgets, COST_WINDOW_MS } from "./cost.ts";

export { computeGoldenSignals, GOLDEN_WINDOW_MS } from "./golden.ts";

export { firstSloInvite } from "./busiest.ts";

export { rankedFindings, compareFindings, type FindingInputs } from "./rank.ts";

export {
  composeVerdict,
  formatExhaustion,
  formatBurnRate,
  formatBudgetDuration,
} from "./verdict.ts";

export {
  OVERVIEW_NOW,
  OVERVIEW_MANIFEST,
  OVERVIEW_INPUTS_FIXTURE,
  OVERVIEW_DAY_ONE_INPUTS,
  OVERVIEW_BURN_RUNS,
  OVERVIEW_DIFF_FIXTURE,
  OVERVIEW_VAULT_FIXTURE,
} from "./fixture.ts";
