/**
 * Build a {@link WideEvent} from an execution context — zero instrumentation.
 *
 * Dimensions come from the flow contract, trigger, principals, effect ledger,
 * and {@link RunTelemetry} accumulated through `fx`.
 */

import type { EffectLedger } from "../kernel/effects.ts";
import type { FlowFailure } from "../kernel/errors.ts";
import type { AnyFlowDef } from "../kernel/flow.ts";
import type { Fx } from "../kernel/fx.ts";
import type { Trigger } from "../kernel/triggers.ts";
import type { FlowPlane } from "../manifest/types.ts";
import { cacheDimensionOf, type RunTelemetry } from "../kernel/run-telemetry.ts";
import type { RunError, WideEvent } from "./types.ts";

/** Inputs for {@link collectWideEvent}. */
export interface CollectWideEventInput {
  /** Flow definition. */
  readonly flow: AnyFlowDef;
  /** Trigger that started the run. */
  readonly trigger: Trigger;
  /** Fx context (principals). */
  readonly fx: Fx;
  /** Effect ledger for this invocation. */
  readonly ledger: EffectLedger;
  /** Telemetry collector (logs, cache, gates, cost). */
  readonly telemetry: RunTelemetry;
  /** Epoch-ms when the run started. */
  readonly startedAt: number;
  /** Epoch-ms when the run ended. */
  readonly endedAt: number;
  /** Pipeline failure when present. */
  readonly failure?: FlowFailure | null;
  /** Optional parent run id (causal chain). */
  readonly parentId?: string;
  /** Optional run id (generated when omitted). */
  readonly id?: string;
  /** Build version stamp. */
  readonly buildVersion?: string;
  /**
   * Personal field cleartext to archive under the subject key.
   * Keys become ciphertext entries on {@link WideEvent.archived}.
   */
  readonly archiveFields?: Readonly<Record<string, string>>;
  /** Pre-encrypted archived map (when shred already ran). */
  readonly archived?: Readonly<Record<string, string>>;
}

/**
 * Collect every declared / observed dimension into one wide event.
 *
 * @param input - Execution context
 */
export function collectWideEvent(input: CollectWideEventInput): WideEvent {
  const plane: FlowPlane = input.flow.plane ?? "user";
  const principal = plane === "operator" ? input.fx.operator.id : input.fx.auth.userId;
  const tenant = input.fx.tenant.id;
  const subjectId = input.telemetry.subjectId ?? principal ?? tenant ?? null;
  const cache = cacheDimensionOf(input.telemetry);
  const gates =
    input.telemetry.gates.length > 0 ? [...input.telemetry.gates] : httpGates(input.trigger);

  const error = failureToRunError(input.failure);
  const durationMs = Math.max(0, input.endedAt - input.startedAt);

  const dimensions: WideEvent["dimensions"] = {
    flow: input.flow.name,
    unit: input.flow.unit ?? null,
    trigger: input.trigger.kind,
    plane,
    tenant: tenant ?? null,
    principal: principal ?? null,
    cache,
    replica: input.telemetry.replica ?? null,
    replica_lag_ms: input.telemetry.replicaLagMs ?? null,
    cost: input.telemetry.cost || null,
    prompt_version: input.telemetry.promptVersion ?? null,
    build_version: input.buildVersion ?? null,
    error_code: error?.code ?? null,
    duration_ms: durationMs,
    ...input.telemetry.dimensions,
  };

  return {
    id: input.id ?? crypto.randomUUID(),
    ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    flow: input.flow.name,
    ...(input.flow.unit !== undefined ? { unit: input.flow.unit } : {}),
    trigger: input.trigger.kind,
    plane,
    tenant,
    principal,
    subjectId,
    gates,
    cache,
    ...(input.telemetry.replica !== undefined ? { replica: input.telemetry.replica } : {}),
    ...(input.telemetry.replicaLagMs !== undefined
      ? { replicaLagMs: input.telemetry.replicaLagMs }
      : {}),
    ...(input.telemetry.cost > 0 ? { cost: input.telemetry.cost } : {}),
    ...(input.telemetry.promptVersion !== undefined
      ? { promptVersion: input.telemetry.promptVersion }
      : {}),
    ...(input.buildVersion !== undefined ? { buildVersion: input.buildVersion } : {}),
    error,
    effects: [...input.ledger.entries],
    logs: [...input.telemetry.logs],
    durationMs,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    ...(input.archived !== undefined ? { archived: input.archived } : {}),
    dimensions,
  };
}

function httpGates(trigger: Trigger): string[] {
  if (trigger.kind !== "http") return [];
  return trigger.gates.map((g) => (typeof g === "string" ? g : g.name));
}

function failureToRunError(failure: FlowFailure | null | undefined): RunError | null {
  if (!failure) return null;
  const code = failure.error?.code ?? "failure";
  const message = failure.error?.message;
  return message !== undefined ? { code, message } : { code };
}
