/**
 * Project API rows ↔ Runs panel records ↔ WideEvent for outlier explanation.
 */

import type { WideEvent } from "../../../runs/types.ts";
import type { RunRecord } from "./types.ts";

/** Loose API row from `console.runs.list`. */
export interface RunsListRow {
  readonly id: string;
  readonly parentId?: string | null;
  readonly flow: string;
  readonly unit?: string | null;
  readonly trigger: string;
  readonly plane: string;
  readonly tenant?: string | null;
  readonly principal?: string | null;
  readonly gates?: readonly string[];
  readonly cache?: "hit" | "miss" | "none";
  readonly replica?: "primary" | "replica" | null;
  readonly replicaLagMs?: number | null;
  readonly cost?: number | null;
  readonly promptVersion?: number | null;
  readonly buildVersion?: string | null;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly error?: string | null;
  readonly effects?: RunRecord["effects"];
  readonly logs?: RunRecord["logs"];
  readonly dimensions?: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * Map an API row to a {@link RunRecord}.
 *
 * @param row - GET /console/runs row
 */
export function rowToRun(row: RunsListRow): RunRecord {
  const dimensions: Record<string, string | number | boolean | null> = {
    ...(row.dimensions ?? {}),
  };
  // Ensure top-level fields are queryable even when dimensions omit them.
  if (dimensions.flow === undefined) dimensions.flow = row.flow;
  if (dimensions.unit === undefined) dimensions.unit = row.unit ?? null;
  if (dimensions.trigger === undefined) dimensions.trigger = row.trigger;
  if (dimensions.plane === undefined) dimensions.plane = row.plane;
  if (dimensions.tenant === undefined) dimensions.tenant = row.tenant ?? null;
  if (dimensions.principal === undefined) {
    dimensions.principal = row.principal ?? null;
  }
  if (dimensions.cache === undefined) {
    dimensions.cache = row.cache ?? "none";
  }
  if (dimensions.duration_ms === undefined) {
    dimensions.duration_ms = row.durationMs;
  }
  if (dimensions.error_code === undefined && row.error) {
    dimensions.error_code = row.error;
  }

  return {
    id: row.id,
    parentId: row.parentId ?? null,
    flow: row.flow,
    unit: row.unit ?? null,
    trigger: row.trigger,
    plane: row.plane,
    tenant: row.tenant ?? null,
    principal: row.principal ?? null,
    gates: row.gates ?? [],
    cache: row.cache ?? "none",
    replica: row.replica ?? null,
    replicaLagMs: row.replicaLagMs ?? null,
    cost: row.cost ?? null,
    promptVersion: row.promptVersion ?? null,
    buildVersion: row.buildVersion ?? null,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMs: row.durationMs,
    error: row.error ?? null,
    effects: row.effects ?? [],
    logs: row.logs ?? [],
    dimensions,
  };
}

/**
 * Convert a run record into a WideEvent shape for {@link explainOutliers}.
 *
 * @param run - Panel record
 */
export function runToWideEvent(run: RunRecord): WideEvent {
  return {
    id: run.id,
    ...(run.parentId ? { parentId: run.parentId } : {}),
    flow: run.flow,
    ...(run.unit ? { unit: run.unit } : {}),
    trigger: run.trigger,
    plane: run.plane as WideEvent["plane"],
    tenant: run.tenant,
    principal: run.principal,
    gates: run.gates,
    cache: run.cache,
    ...(run.replica ? { replica: run.replica } : {}),
    ...(run.replicaLagMs != null ? { replicaLagMs: run.replicaLagMs } : {}),
    ...(run.cost != null ? { cost: run.cost } : {}),
    ...(run.promptVersion != null ? { promptVersion: run.promptVersion } : {}),
    ...(run.buildVersion ? { buildVersion: run.buildVersion } : {}),
    error: run.error ? { code: run.error } : null,
    effects: run.effects as WideEvent["effects"],
    logs: run.logs,
    durationMs: run.durationMs,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    dimensions: { ...run.dimensions },
  };
}
