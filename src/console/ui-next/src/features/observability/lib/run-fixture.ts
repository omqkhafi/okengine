/**
 * Shared RunRow fixture for Observability lib tests.
 */

import type { RunRow } from "@/client.ts";

/**
 * Build a RunRow with required defaults.
 *
 * @param partial - Overrides (must include id / flow / startedAt)
 */
export function monitoringRun(
  partial: Partial<RunRow> & Pick<RunRow, "id" | "flow" | "startedAt">,
): RunRow {
  return {
    parentId: null,
    unit: null,
    trigger: "http",
    plane: "user",
    tenant: null,
    principal: null,
    gates: [],
    cache: "none",
    replica: null,
    replicaLagMs: null,
    cost: null,
    promptVersion: null,
    buildVersion: null,
    endedAt: partial.startedAt + (partial.durationMs ?? 1),
    durationMs: 1,
    error: null,
    errorMessage: null,
    sampled: "sample",
    effects: [],
    logs: [],
    dimensions: {},
    input: null,
    output: null,
    ...partial,
  };
}
