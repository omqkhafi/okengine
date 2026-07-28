/**
 * AI panel pure modules (console §9.10).
 */

export type {
  AgentCatalogueRow,
  AgentDenial,
  AgentRunRow,
  AgentToolEffect,
  AiAskOutcome,
  AiDistributionBucket,
  AiFallbackAttempt,
  AiListResponse,
  AiMetricDistribution,
  AllowPiiRow,
  FallbackChainRow,
  PromptCatalogueRow,
  PromptVersionMetrics,
} from "./types.ts";

export {
  parseAiSearch,
  serializeAiSearch,
  openPromptVersion,
  openAgentRun,
  manifestDiffHref,
  type AiSearch,
} from "./search.ts";

export {
  promotionDecision,
  formatPromotionBlockers,
  type PromotionBlocker,
  type PromotionDecision,
  type PromotionNumbers,
} from "./promotion.ts";

export {
  filterPrompts,
  filterAgents,
  versionsForPrompt,
  runsForAgent,
  allowPiiStanding,
} from "./group.ts";

export {
  formatRate,
  formatCost,
  formatLatency,
  formatEval,
  distributionSummary,
  maxBucketCount,
  formatEffect,
  trailStatusLabel,
} from "./format.ts";

export { AI_LIST_FIXTURE, VERSION_V2, VERSION_V3 } from "./fixture.ts";

export { overBudgetFindings, type OverBudgetFinding } from "./findings.ts";
