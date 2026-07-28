/**
 * Filter / group AI catalogue rows (console §9.10).
 */

import type {
  AgentCatalogueRow,
  AgentRunRow,
  AllowPiiRow,
  PromptCatalogueRow,
  PromptVersionMetrics,
} from "./types.ts";

/**
 * Filter prompts by substring.
 *
 * @param prompts - Catalogue
 * @param q - Query
 */
export function filterPrompts(
  prompts: readonly PromptCatalogueRow[],
  q: string | undefined,
): readonly PromptCatalogueRow[] {
  const needle = q?.trim().toLowerCase();
  if (!needle) return prompts;
  return prompts.filter(
    (p) =>
      p.name.toLowerCase().includes(needle) || (p.model?.toLowerCase().includes(needle) ?? false),
  );
}

/**
 * Filter agents by substring.
 *
 * @param agents - Catalogue
 * @param q - Query
 */
export function filterAgents(
  agents: readonly AgentCatalogueRow[],
  q: string | undefined,
): readonly AgentCatalogueRow[] {
  const needle = q?.trim().toLowerCase();
  if (!needle) return agents;
  return agents.filter(
    (a) =>
      a.name.toLowerCase().includes(needle) ||
      a.tools.some((t) => t.toLowerCase().includes(needle)),
  );
}

/**
 * Versions for one prompt, sorted ascending.
 *
 * @param versions - All version metrics
 * @param prompt - Prompt name
 */
export function versionsForPrompt(
  versions: readonly PromptVersionMetrics[],
  prompt: string,
): readonly PromptVersionMetrics[] {
  return versions.filter((v) => v.prompt === prompt).sort((a, b) => a.version - b.version);
}

/**
 * Agent runs for one agent.
 *
 * @param runs - All runs
 * @param agent - Agent name
 */
export function runsForAgent(runs: readonly AgentRunRow[], agent: string): readonly AgentRunRow[] {
  return runs.filter((r) => r.agent === agent);
}

/**
 * Rows that explicitly allow PII egress (standing security review).
 *
 * @param rows - All allowPii projections
 */
export function allowPiiStanding(rows: readonly AllowPiiRow[]): readonly AllowPiiRow[] {
  return rows.filter((r) => r.allowPii);
}
