/**
 * Console AI projection — AiRuntime journal / denial ledger + Manifest
 * + wide events (console §9.10).
 *
 * The UI must not recompute cost or re-derive denials.
 */

import { mockAiDriver } from "../../drivers/ai-mock.ts";
import {
  ai,
  createAiRuntime,
  type AgentDenial,
  type AgentRunRecord,
  type AgentToolEffect,
  type AiAskOutcome,
  type AiFallbackAttempt,
  type AiJournalEntry,
  type AiRuntime,
  type EvalSuiteResult,
} from "../../elements/ai.ts";
import type { Manifest } from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";

/** One numeric sample in a distribution. */
export interface AiSample {
  readonly value: number;
  readonly at: number;
  readonly version?: number;
}

/** Histogram bucket for a metric distribution. */
export interface AiDistributionBucket {
  readonly min: number;
  readonly max: number;
  readonly count: number;
}

/** Per-prompt-version quality / cost metrics (real numbers). */
export interface PromptVersionMetrics {
  readonly prompt: string;
  readonly version: number;
  readonly sampleCount: number;
  readonly cost: {
    readonly samples: readonly number[];
    readonly mean: number;
    readonly p50: number;
    readonly p95: number;
    readonly buckets: readonly AiDistributionBucket[];
  };
  readonly latencyMs: {
    readonly samples: readonly number[];
    readonly mean: number;
    readonly p50: number;
    readonly p95: number;
    readonly buckets: readonly AiDistributionBucket[];
  };
  readonly evalScore: {
    readonly samples: readonly number[];
    readonly mean: number;
    readonly buckets: readonly AiDistributionBucket[];
  };
  /** Schema-invalid rate — distinct from provider errors. */
  readonly schemaInvalidRate: number;
  readonly providerErrorRate: number;
  readonly okRate: number;
  readonly overBudgetRate: number;
  readonly budgetMaxCostPerCall: number | null;
  readonly outcomeCounts: Readonly<Record<AiAskOutcome, number>>;
}

/** Standing security-review row for `allowPii`. */
export interface AllowPiiRow {
  readonly flowId: string;
  readonly asks: readonly string[];
  readonly pii: "masked" | "allow" | "denied" | null;
  readonly allowPii: boolean;
  readonly source: string | null;
}

/** Fallback chain with cost consequence vs primary-only. */
export interface FallbackChainRow {
  readonly prompt: string;
  readonly version: number | undefined;
  readonly attempts: readonly AiFallbackAttempt[];
  readonly actualCost: number;
  readonly primaryOnlyCost: number | null;
  readonly costConsequence: number | null;
  readonly at: number;
}

/** Agent run projection — trail from the denial ledger. */
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

/** Catalogue prompt row. */
export interface PromptCatalogueRow {
  readonly name: string;
  readonly version: number | undefined;
  readonly model: string | undefined;
  readonly evals: string | undefined;
  readonly budgetMaxCostPerCall: number | null;
  /** Manifest Diff deep-link path for a version bump. */
  readonly manifestDiffPath: string;
}

/** Catalogue agent row. */
export interface AgentCatalogueRow {
  readonly name: string;
  readonly tools: readonly string[];
  readonly maxSteps: number | undefined;
  readonly model: string | undefined;
  readonly budgetMaxCostPerRun: number | null;
}

/** Full AI panel projection. */
export interface ConsoleAiProjection {
  readonly prompts: readonly PromptCatalogueRow[];
  readonly agents: readonly AgentCatalogueRow[];
  readonly versions: readonly PromptVersionMetrics[];
  readonly allowPii: readonly AllowPiiRow[];
  readonly fallbackChains: readonly FallbackChainRow[];
  readonly agentRuns: readonly AgentRunRow[];
  readonly denials: readonly AgentDenial[];
  readonly journal: readonly AiJournalEntry[];
}

/** Options for {@link projectAiPanel}. */
export interface ProjectAiOptions {
  readonly manifest: Manifest | null;
  readonly aiRuntime: AiRuntime | null;
  readonly runs?: readonly WideEvent[];
  readonly evalResults?: readonly EvalSuiteResult[];
  readonly bucketCount?: number;
}

/**
 * Build an {@link AiRuntime} from Manifest AI catalogue (mock driver default).
 * Agent tool effects come from Manifest flow declarations — the denial ledger
 * records them; the UI must not re-derive.
 *
 * @param manifest - Manifest
 * @param options - Clock
 */
export function createManifestAiRuntime(
  manifest: Manifest | null,
  options: { readonly now?: () => number } = {},
): AiRuntime {
  const models = Object.entries(manifest?.ai?.models ?? {}).map(([name, m]) =>
    ai.model(name, {
      ...(m.provider !== undefined ? { provider: m.provider } : {}),
      ...(m.tier !== undefined ? { tier: m.tier } : {}),
      ...(m.model !== undefined ? { model: m.model } : {}),
    }),
  );
  const modelByName = new Map(models.map((m) => [m.name, m]));
  const prompts = Object.entries(manifest?.ai?.prompts ?? {}).map(([name, p]) => {
    const modelName = p.model ?? models[0]?.name ?? "mock";
    const handle = modelByName.get(modelName) ?? ai.model(modelName);
    return handle.prompt(name, {
      ...(p.version !== undefined ? { version: p.version } : {}),
      ...(p.evals !== undefined ? { evals: p.evals } : {}),
      ...(p.budget !== undefined ? { budget: p.budget } : {}),
      ...(p.in !== undefined ? { in: p.in } : {}),
      ...(p.out !== undefined ? { out: p.out } : {}),
    });
  });
  const agents = Object.entries(manifest?.ai?.agents ?? {}).map(([name, a]) =>
    ai.agent(name, {
      tools: a.tools ?? [],
      ...(a.maxSteps !== undefined ? { maxSteps: a.maxSteps } : {}),
      ...(a.budget !== undefined ? { budget: a.budget } : {}),
      ...(a.model !== undefined ? { model: a.model } : {}),
    }),
  );

  return createAiRuntime({
    models:
      models.length > 0
        ? models
        : prompts.length > 0
          ? [ai.model("mock", { provider: "mock" })]
          : [],
    prompts,
    agents,
    defaultDriver: mockAiDriver,
    effectsForFlow: (flowName) => effectsForFlowFromManifest(manifest, flowName),
    now: options.now,
  });
}

/**
 * Project AI panel data from Manifest + AiRuntime + runs + eval history.
 *
 * @param options - Sources
 */
export function projectAiPanel(options: ProjectAiOptions): ConsoleAiProjection {
  const manifest = options.manifest;
  const runtime = options.aiRuntime;
  const bucketCount = options.bucketCount ?? 10;

  const prompts: PromptCatalogueRow[] = [];
  const promptMeta = new Map<
    string,
    { version?: number; budget?: number | null; model?: string }
  >();

  for (const [name, p] of Object.entries(manifest?.ai?.prompts ?? {})) {
    const budget = p.budget?.maxCostPerCall ?? null;
    prompts.push({
      name,
      version: p.version,
      model: p.model,
      evals: p.evals,
      budgetMaxCostPerCall: budget,
      manifestDiffPath: `/ai/prompts/${name}/version`,
    });
    promptMeta.set(name, {
      version: p.version,
      budget,
      model: p.model,
    });
  }
  if (runtime) {
    for (const [name, p] of runtime.prompts) {
      if (promptMeta.has(name)) continue;
      const budget = p.budget?.maxCostPerCall ?? null;
      prompts.push({
        name,
        version: p.version,
        model: p.model,
        evals: p.evals,
        budgetMaxCostPerCall: budget,
        manifestDiffPath: `/ai/prompts/${name}/version`,
      });
      promptMeta.set(name, {
        version: p.version,
        budget,
        model: p.model,
      });
    }
  }
  prompts.sort((a, b) => a.name.localeCompare(b.name));

  const agents: AgentCatalogueRow[] = [];
  for (const [name, a] of Object.entries(manifest?.ai?.agents ?? {})) {
    agents.push({
      name,
      tools: a.tools ?? [],
      maxSteps: a.maxSteps,
      model: a.model,
      budgetMaxCostPerRun: a.budget?.maxCostPerRun ?? null,
    });
  }
  if (runtime) {
    for (const [name, a] of runtime.agents) {
      if (agents.some((x) => x.name === name)) continue;
      agents.push({
        name,
        tools: a.tools,
        maxSteps: a.maxSteps,
        model: a.model,
        budgetMaxCostPerRun: a.budget?.maxCostPerRun ?? null,
      });
    }
  }
  agents.sort((a, b) => a.name.localeCompare(b.name));

  const journal = runtime?.journal ?? [];
  const versions = buildVersionMetrics({
    journal,
    runs: options.runs ?? [],
    evalResults: options.evalResults ?? [],
    promptMeta,
    bucketCount,
  });

  const allowPii = projectAllowPii(manifest);
  const fallbackChains = projectFallbackChains(journal);
  const agentRuns = projectAgentRuns(runtime?.agentRuns ?? []);
  const denials = runtime?.denials ?? [];

  return {
    prompts,
    agents,
    versions,
    allowPii,
    fallbackChains,
    agentRuns,
    denials,
    journal,
  };
}

/**
 * Resolve Manifest effects for a tool flow into the agent trail vocabulary.
 *
 * @param manifest - Manifest
 * @param flowName - Tool / flow name
 */
export function effectsForFlowFromManifest(
  manifest: Manifest | null,
  flowName: string,
): readonly AgentToolEffect[] {
  const flow = manifest?.flows?.[flowName];
  if (!flow?.effects) return [];
  const out: AgentToolEffect[] = [];
  for (const r of flow.effects.reads ?? []) {
    out.push({ kind: "read", resource: r });
  }
  for (const r of flow.effects.writes ?? []) {
    out.push({ kind: "write", resource: r });
  }
  for (const r of flow.effects.emits ?? []) {
    out.push({ kind: "emit", resource: r });
  }
  for (const r of flow.effects.sends ?? []) {
    out.push({ kind: "send", resource: r });
  }
  for (const r of flow.effects.asks ?? []) {
    out.push({ kind: "ask", resource: r });
  }
  for (const r of flow.effects.secrets ?? []) {
    out.push({ kind: "secret", resource: r });
  }
  for (const r of flow.effects.calls ?? []) {
    out.push({ kind: "call", resource: r });
  }
  return out;
}

/**
 * Standing `allowPii` security-review table from Manifest flows.
 *
 * @param manifest - Manifest
 */
export function projectAllowPii(manifest: Manifest | null): readonly AllowPiiRow[] {
  if (!manifest?.flows) return [];
  const rows: AllowPiiRow[] = [];
  for (const [flowId, flow] of Object.entries(manifest.flows)) {
    const allow = flow.allowPii === true || flow.pii === "allow";
    const asks = flow.effects?.asks ?? [];
    if (!allow && asks.length === 0) continue;
    if (!allow && flow.pii === undefined) continue;
    rows.push({
      flowId,
      asks: [...asks],
      pii: flow.pii ?? null,
      allowPii: allow,
      source: flow.source ?? null,
    });
  }
  // Prefer rows that actually acknowledge PII egress
  return rows
    .filter((r) => r.allowPii || r.asks.length > 0)
    .sort((a, b) => {
      if (a.allowPii !== b.allowPii) return a.allowPii ? -1 : 1;
      return a.flowId.localeCompare(b.flowId);
    });
}

function projectFallbackChains(journal: readonly AiJournalEntry[]): readonly FallbackChainRow[] {
  const rows: FallbackChainRow[] = [];
  for (const entry of journal) {
    if (entry.attempts.length < 2) continue;
    const primary = entry.attempts[0];
    const primaryOnlyCost =
      primary?.ok && primary.cost !== undefined
        ? primary.cost
        : primary && !primary.ok
          ? null
          : (primary?.cost ?? null);
    // Cost consequence: actual chain cost minus what primary-only would have been
    // when primary succeeded; when primary failed, consequence is the full chain cost.
    let costConsequence: number | null = null;
    if (primary && !primary.ok) {
      costConsequence = entry.cost;
    } else if (primaryOnlyCost !== null) {
      costConsequence = entry.cost - primaryOnlyCost;
    }
    rows.push({
      prompt: entry.prompt,
      version: entry.version,
      attempts: entry.attempts,
      actualCost: entry.cost,
      primaryOnlyCost,
      costConsequence,
      at: entry.at,
    });
  }
  return rows.sort((a, b) => b.at - a.at);
}

function projectAgentRuns(runs: readonly AgentRunRecord[]): readonly AgentRunRow[] {
  return [...runs]
    .sort((a, b) => b.at - a.at)
    .map((r) => ({
      id: r.id,
      agent: r.agent,
      message: r.message,
      ok: r.ok,
      steps: r.steps,
      cost: r.cost,
      at: r.at,
      trail: r.trail.map((step) => ({
        tool: step.tool,
        status: step.status,
        effects: step.effects,
        denial: step.denial ?? null,
        at: step.at,
      })),
      denials: r.denials,
    }));
}

function buildVersionMetrics(input: {
  readonly journal: readonly AiJournalEntry[];
  readonly runs: readonly WideEvent[];
  readonly evalResults: readonly EvalSuiteResult[];
  readonly promptMeta: Map<string, { version?: number; budget?: number | null; model?: string }>;
  readonly bucketCount: number;
}): readonly PromptVersionMetrics[] {
  type Acc = {
    prompt: string;
    version: number;
    costs: number[];
    latencies: number[];
    evals: number[];
    outcomes: Record<AiAskOutcome, number>;
    overBudget: number;
    budget: number | null;
  };
  const map = new Map<string, Acc>();

  const keyOf = (prompt: string, version: number) => `${prompt}@${version}`;

  const ensure = (prompt: string, version: number): Acc => {
    const k = keyOf(prompt, version);
    let acc = map.get(k);
    if (!acc) {
      const meta = input.promptMeta.get(prompt);
      acc = {
        prompt,
        version,
        costs: [],
        latencies: [],
        evals: [],
        outcomes: { ok: 0, provider_error: 0, schema_invalid: 0 },
        overBudget: 0,
        budget: meta?.budget ?? null,
      };
      map.set(k, acc);
    }
    return acc;
  };

  for (const entry of input.journal) {
    const version = entry.version ?? input.promptMeta.get(entry.prompt)?.version ?? 0;
    const acc = ensure(entry.prompt, version);
    acc.costs.push(entry.cost);
    acc.latencies.push(entry.latencyMs);
    acc.outcomes[entry.outcome] += 1;
    if (acc.budget !== null && entry.cost > acc.budget) {
      acc.overBudget += 1;
    }
  }

  // Wide events contribute cost / latency when promptVersion is present
  for (const run of input.runs) {
    const ask = run.effects.find((e) => e.kind === "ask");
    if (!ask) continue;
    const prompt = ask.resource.replace(/^ask:/, "");
    const version = run.promptVersion;
    if (version === undefined) continue;
    const acc = ensure(prompt, version);
    if (run.cost !== undefined) acc.costs.push(run.cost);
    acc.latencies.push(run.durationMs);
    if (run.error?.code === "AiSchemaInvalid") {
      acc.outcomes.schema_invalid += 1;
    } else if (run.error) {
      acc.outcomes.provider_error += 1;
    } else {
      acc.outcomes.ok += 1;
    }
    const budget = acc.budget;
    if (budget !== null && (run.cost ?? 0) > budget) {
      acc.overBudget += 1;
    }
  }

  for (const suite of input.evalResults) {
    const version = suite.version ?? input.promptMeta.get(suite.prompt)?.version;
    if (version === undefined) continue;
    const total = suite.passed + suite.failed;
    if (total === 0) continue;
    const score = suite.passed / total;
    ensure(suite.prompt, version).evals.push(score);
  }

  const out: PromptVersionMetrics[] = [];
  for (const acc of map.values()) {
    const totalOutcomes =
      acc.outcomes.ok + acc.outcomes.provider_error + acc.outcomes.schema_invalid;
    out.push({
      prompt: acc.prompt,
      version: acc.version,
      sampleCount: Math.max(acc.costs.length, totalOutcomes),
      cost: metricBlock(acc.costs, input.bucketCount),
      latencyMs: metricBlock(acc.latencies, input.bucketCount),
      evalScore: metricBlock(acc.evals, input.bucketCount),
      schemaInvalidRate: totalOutcomes === 0 ? 0 : acc.outcomes.schema_invalid / totalOutcomes,
      providerErrorRate: totalOutcomes === 0 ? 0 : acc.outcomes.provider_error / totalOutcomes,
      okRate: totalOutcomes === 0 ? 0 : acc.outcomes.ok / totalOutcomes,
      overBudgetRate: acc.costs.length === 0 ? 0 : acc.overBudget / acc.costs.length,
      budgetMaxCostPerCall: acc.budget,
      outcomeCounts: acc.outcomes,
    });
  }

  return out.sort((a, b) => {
    const byPrompt = a.prompt.localeCompare(b.prompt);
    if (byPrompt !== 0) return byPrompt;
    return a.version - b.version;
  });
}

function metricBlock(
  samples: readonly number[],
  bucketCount: number,
): PromptVersionMetrics["cost"] {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: sorted,
    mean: mean(sorted),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    buckets: histogram(sorted, bucketCount),
  };
}

/**
 * Arithmetic mean (0 when empty).
 *
 * @param values - Samples
 */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Nearest-rank percentile (0 when empty).
 *
 * @param sorted - Ascending samples
 * @param p - Percentile in [0, 1]
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

/**
 * Equal-width histogram over samples.
 *
 * @param sorted - Ascending samples
 * @param bucketCount - Buckets
 */
export function histogram(
  sorted: readonly number[],
  bucketCount: number,
): readonly AiDistributionBucket[] {
  if (sorted.length === 0 || bucketCount < 1) return [];
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  if (min === max) {
    return [{ min, max: max + Number.EPSILON, count: sorted.length }];
  }
  const width = (max - min) / bucketCount;
  const buckets: AiDistributionBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const lo = min + i * width;
    const hi = i === bucketCount - 1 ? max + Number.EPSILON : min + (i + 1) * width;
    buckets.push({ min: lo, max: hi, count: 0 });
  }
  for (const v of sorted) {
    let idx = Math.floor((v - min) / width);
    if (idx < 0) idx = 0;
    if (idx >= bucketCount) idx = bucketCount - 1;
    const b = buckets[idx]!;
    buckets[idx] = { ...b, count: b.count + 1 };
  }
  return buckets;
}
