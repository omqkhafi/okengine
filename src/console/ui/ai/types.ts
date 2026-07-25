/**
 * AI panel view types (console §9.10).
 */

/** Ask outcome class — schema failure ≠ provider error. */
export type AiAskOutcome = "ok" | "provider_error" | "schema_invalid";

/** Histogram bucket. */
export interface AiDistributionBucket {
  readonly min: number;
  readonly max: number;
  readonly count: number;
}

/** Metric distribution block. */
export interface AiMetricDistribution {
  readonly samples: readonly number[];
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly buckets: readonly AiDistributionBucket[];
}

/** Per-prompt-version metrics. */
export interface PromptVersionMetrics {
  readonly prompt: string;
  readonly version: number;
  readonly sampleCount: number;
  readonly cost: AiMetricDistribution;
  readonly latencyMs: AiMetricDistribution;
  readonly evalScore: AiMetricDistribution;
  readonly schemaInvalidRate: number;
  readonly providerErrorRate: number;
  readonly okRate: number;
  readonly overBudgetRate: number;
  readonly budgetMaxCostPerCall: number | null;
  readonly outcomeCounts: Readonly<Record<AiAskOutcome, number>>;
}

/** Catalogue prompt. */
export interface PromptCatalogueRow {
  readonly name: string;
  readonly version: number | undefined;
  readonly model: string | undefined;
  readonly evals: string | undefined;
  readonly budgetMaxCostPerCall: number | null;
  readonly manifestDiffPath: string;
}

/** Catalogue agent. */
export interface AgentCatalogueRow {
  readonly name: string;
  readonly tools: readonly string[];
  readonly maxSteps: number | undefined;
  readonly model: string | undefined;
  readonly budgetMaxCostPerRun: number | null;
}

/** Standing allowPii security row. */
export interface AllowPiiRow {
  readonly flowId: string;
  readonly asks: readonly string[];
  readonly pii: "masked" | "allow" | "denied" | null;
  readonly allowPii: boolean;
  readonly source: string | null;
}

/** Fallback attempt. */
export interface AiFallbackAttempt {
  readonly model: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly cost?: number;
  readonly latencyMs?: number;
  readonly at: number;
}

/** Fallback chain with cost consequence. */
export interface FallbackChainRow {
  readonly prompt: string;
  readonly version: number | undefined;
  readonly attempts: readonly AiFallbackAttempt[];
  readonly actualCost: number;
  readonly primaryOnlyCost: number | null;
  readonly costConsequence: number | null;
  readonly at: number;
}

/** Agent tool effect — Flows/Traces vocabulary. */
export interface AgentToolEffect {
  readonly kind:
    | "read"
    | "write"
    | "emit"
    | "send"
    | "ask"
    | "secret"
    | "call";
  readonly resource: string;
}

/** Denial ledger entry. */
export interface AgentDenial {
  readonly agent: string;
  readonly tool: string;
  readonly gate: string;
  readonly reason: string;
  readonly at: number;
}

/** Agent run trail row. */
export interface AgentRunRow {
  readonly id: string;
  readonly agent: string;
  readonly message: string;
  readonly ok: boolean;
  readonly steps: number;
  readonly cost: number;
  readonly at: number;
  readonly trail: ReadonlyArray<{
    readonly tool: string;
    readonly status: "ok" | "denied";
    readonly effects: readonly AgentToolEffect[];
    readonly denial: AgentDenial | null;
    readonly at: number;
  }>;
  readonly denials: readonly AgentDenial[];
}

/** Full list response from `console.ai.list`. */
export interface AiListResponse {
  readonly prompts: readonly PromptCatalogueRow[];
  readonly agents: readonly AgentCatalogueRow[];
  readonly versions: readonly PromptVersionMetrics[];
  readonly allowPii: readonly AllowPiiRow[];
  readonly fallbackChains: readonly FallbackChainRow[];
  readonly agentRuns: readonly AgentRunRow[];
  readonly denials: readonly AgentDenial[];
}
