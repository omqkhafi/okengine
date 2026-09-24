/**
 * Bind MCP tool adapters to the live Console state (same Manifest / runs).
 *
 * Used by `oke dev` so port 6535 is not a separate mock context.
 */

import { createFileDiff, emitStructuralDiff } from "../console/server/structural.ts";
import type { Manifest } from "../manifest/types.ts";
import type { WideEvent } from "../runs/types.ts";
import type { McpContext } from "../mcp/tools.ts";

/**
 * Minimal Console surface MCP needs — duck-typed so tests can pass a
 * partial stand-in without importing the full {@link ConsoleState}.
 */
export interface McpConsoleSurface {
  /** Live Manifest snapshot (mutated by Console / host). */
  manifest: Manifest | null;
  /** Same runs provider Console panels use. */
  readonly listRuns: () => Promise<readonly WideEvent[]>;
  /** Working-tree root for structural proposals. */
  readonly cwd: string;
  /** Clock shared with Console. */
  readonly now: () => number;
  /** Journal that holds agent events and parked approvals. */
  readonly journalStore?: import("../kernel/journal.ts").JournalStore | null;
  /** In-process agent ledger. The follow log is the durable source. */
  readonly aiRuntime?: import("../elements/ai.ts").AiRuntime | null;
}

/**
 * Create an {@link McpContext} that reads through a live Console surface.
 *
 * @param state - Console state (or test stand-in)
 */
export function mcpContextFromConsole(state: McpConsoleSurface): McpContext {
  return {
    getManifest: () => state.manifest,
    listRuns: () => state.listRuns(),
    listAgentRuns: async () => {
      const { loadConsoleAgentRuns } = await import("../console/server/ai-runs.ts");
      return loadConsoleAgentRuns({
        runtime: state.aiRuntime ?? null,
        store: state.journalStore ?? null,
        now: state.now(),
      });
    },
    getAgentRun: async (runId) => {
      const { loadConsoleAgentRun } = await import("../console/server/ai-runs.ts");
      const run = await loadConsoleAgentRun(
        {
          runtime: state.aiRuntime ?? null,
          store: state.journalStore ?? null,
          now: state.now(),
        },
        runId,
      );
      if (!run) return undefined;
      return { run, events: run.events };
    },
    listApprovals: async () => {
      const { loadApprovalQueue } = await import("../console/server/ai-runs.ts");
      return loadApprovalQueue(state.journalStore ?? null, state.now());
    },
    listDecisions: async (tenant) => {
      const { loadDecisionQueue, projectMcpDecisions, candidateMetrics } =
        await import("../console/server/decisions.ts");
      const { listDecisionCandidates, loadDecisionCandidate } =
        await import("../elements/ai/decisions/labels.ts");
      const names = await listDecisionCandidates();
      const fitted: Record<string, Record<string, number>> = {};
      for (const name of names) {
        const metrics = candidateMetrics(await loadDecisionCandidate(name));
        if (metrics) fitted[name] = metrics;
      }
      const queue = await loadDecisionQueue(state.journalStore ?? null, state.now(), tenant);
      const pending: Record<string, number> = {};
      for (const row of queue) {
        if (row.status !== "pending" || row.labelOnly) continue;
        pending[row.decision] = (pending[row.decision] ?? 0) + 1;
      }
      return projectMcpDecisions(state.manifest, pending, fitted);
    },
    proposeStructural: async (input) =>
      emitStructuralDiff({
        cwd: state.cwd,
        title: input.title,
        relativePath: input.relativePath,
        diff: createFileDiff(input.relativePath, input.contents),
        actorId: input.operatorId,
        reason: input.reason,
        now: state.now,
      }),
  };
}
