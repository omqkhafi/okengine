/**
 * Cost budgets in the same mental model as error budgets (console §9.16).
 *
 * Declared budget, burn rate, projected exhaustion — from Manifest flow
 * budgets and AI panel metrics + real Runs spend.
 */

import type { Manifest } from "../../../manifest/types.ts";
import type { AiListResponse } from "../ai/types.ts";
import type { RunRecord } from "../runs/types.ts";
import type { CostBudget } from "./types.ts";

/** Rolling window for cost burn (7 days). */
export const COST_WINDOW_MS = 7 * 86_400_000;

/**
 * Project cost budgets from Manifest declarations + AI/Runs spend.
 *
 * @param options - Manifest, AI list, runs, clock
 */
export function computeCostBudgets(options: {
  readonly manifest: Manifest | null;
  readonly ai: AiListResponse | null;
  readonly runs: readonly RunRecord[];
  readonly now: number;
}): readonly CostBudget[] {
  const { manifest, ai, runs, now } = options;
  const from = now - COST_WINDOW_MS;
  const out: CostBudget[] = [];

  for (const [name, flow] of Object.entries(manifest?.flows ?? {})) {
    const budget = flow.cost?.budget;
    if (budget == null || budget <= 0) continue;
    const spent = sumCost(
      runs.filter((r) => r.flow === name && r.startedAt >= from && r.startedAt <= now),
    );
    out.push(
      budgetRow({
        id: `flow:${name}`,
        name,
        kind: "flow",
        declaredBudget: budget,
        spent,
        windowMs: COST_WINDOW_MS,
      }),
    );
  }

  if (ai) {
    for (const prompt of ai.prompts) {
      const cap = prompt.budgetMaxCostPerCall;
      if (cap == null || cap <= 0) continue;
      const version =
        ai.versions.find((v) => v.prompt === prompt.name && v.version === prompt.version) ??
        ai.versions
          .filter((v) => v.prompt === prompt.name)
          .sort((a, b) => b.version - a.version)[0];
      if (!version || version.sampleCount === 0) continue;
      // Per-call budget × samples in window ≈ declared period budget.
      const declaredBudget = cap * version.sampleCount;
      const spent = version.cost.mean * version.sampleCount;
      out.push(
        budgetRow({
          id: `ai-prompt:${prompt.name}@${version.version}`,
          name: `${prompt.name}@${version.version}`,
          kind: "ai-prompt",
          declaredBudget,
          spent,
          windowMs: COST_WINDOW_MS,
        }),
      );
    }

    for (const agent of ai.agents) {
      const cap = agent.budgetMaxCostPerRun;
      if (cap == null || cap <= 0) continue;
      const agentRuns = ai.agentRuns.filter((r) => r.agent === agent.name);
      if (agentRuns.length === 0) continue;
      const declaredBudget = cap * agentRuns.length;
      const spent = agentRuns.reduce((a, r) => a + r.cost, 0);
      out.push(
        budgetRow({
          id: `ai-agent:${agent.name}`,
          name: agent.name,
          kind: "ai-agent",
          declaredBudget,
          spent,
          windowMs: COST_WINDOW_MS,
        }),
      );
    }
  }

  return out.sort((a, b) => b.burnRate - a.burnRate || a.name.localeCompare(b.name));
}

function budgetRow(input: {
  readonly id: string;
  readonly name: string;
  readonly kind: CostBudget["kind"];
  readonly declaredBudget: number;
  readonly spent: number;
  readonly windowMs: number;
}): CostBudget {
  const { declaredBudget, spent, windowMs } = input;
  const burnRate = declaredBudget <= 0 ? 0 : spent / declaredBudget;
  const remainingFraction = Math.max(0, 1 - (declaredBudget <= 0 ? 0 : spent / declaredBudget));
  let timeToExhaustionMs: number | null = null;
  if (spent > 0 && burnRate > 0 && remainingFraction > 0) {
    // At current spend pace, remaining budget lasts:
    const spendPerMs = spent / windowMs;
    if (spendPerMs > 0) {
      timeToExhaustionMs = (declaredBudget - spent) / spendPerMs;
    }
  } else if (burnRate >= 1 && remainingFraction <= 0) {
    timeToExhaustionMs = 0;
  }

  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    declaredBudget,
    spent,
    burnRate,
    remainingFraction,
    timeToExhaustionMs,
    windowMs,
  };
}

function sumCost(runs: readonly RunRecord[]): number {
  return runs.reduce((a, r) => a + (r.cost ?? 0), 0);
}
