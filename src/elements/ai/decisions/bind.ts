/**
 * Boot flows for decisions that declare autonomy: a clock aggregate,
 * a drift monitor, and the operator candidate endpoint.
 */

import { gate } from "../../gate/declare.ts";
import { flow } from "../../../kernel/flow.ts";
import type { Binding } from "../../../kernel/on.ts";
import { http } from "../../../kernel/triggers.ts";
import type { Manifest } from "../../../manifest/types.ts";
import { aiDecisionRegistry } from "../../../kernel/element-registries.ts";
import {
  aggregateDecisionCandidate,
  decisionDriftNames,
  decisionDriftSuspended,
  setDecisionDrift,
} from "./certificate.ts";
import { certifyLabels } from "./certify.ts";
import { decisionExportFields, exportDecisionLabels } from "./export.ts";
import {
  auditDriftExceeded,
  loadDecisionCandidate,
  loadDecisionLabels,
  persistDecisionCandidate,
  persistDecisionDrift,
  pinnedDecision,
} from "./labels.ts";

/** Signal the drift monitor emits. The emit is declared on that flow. */
export const DECISION_DRIFT_SIGNAL = "oke/decision/drift";

/** Operator gate on the candidate route. */
export const decisionOperatorGate = gate.policy(
  "oke.decisions.operator",
  (ctx) => ctx.operator.id !== null,
);

/**
 * True when any decision carries an autonomy block.
 *
 * @param manifest - Boot manifest
 */
export function manifestHasDecisionAutonomy(manifest: Manifest | undefined): boolean {
  const decisions = manifest?.ai?.decisions;
  if (!decisions) return false;
  return Object.values(decisions).some((decision) => decision.autonomy !== undefined);
}

/**
 * Register the aggregate clock, the drift monitor, and the candidate route.
 *
 * @param adopt - App binding sink
 * @param manifest - Boot manifest
 */
export function bindDecisionFlows(adopt: (binding: Binding) => void, manifest: Manifest): void {
  if (!manifestHasDecisionAutonomy(manifest)) return;
  const names = Object.keys(manifest.ai?.decisions ?? {});
  const aggregate = flow("oke.decisions.aggregate", {
    plane: "operator",
    effects: { writes: ["kv:oke-decision-candidate"] },
    do: async () => {
      for (const name of names) {
        const decl = aiDecisionRegistry.find((item) => item.name === name);
        const pinned = pinnedDecision(name);
        const rows = await loadDecisionLabels(name);
        const fitted = aggregateDecisionCandidate(name, () =>
          certifyLabels({
            model: pinned?.model ?? decl?.model ?? "",
            maxError: decl?.autonomy?.maxError ?? 0.05,
            delta: decl?.autonomy?.risk ?? 0.1,
            ask: decl?.ask ?? {},
            labels: rows,
          }),
        );
        await persistDecisionCandidate(name, fitted);
      }
      return { ok: true };
    },
  });
  adopt({
    trigger: { kind: "clock", name: "oke.decisions.aggregate" },
    flow: aggregate,
  });

  const drift = flow("oke.decisions.drift", {
    plane: "operator",
    effects: { emits: [DECISION_DRIFT_SIGNAL] },
    do: async (_input, fx) => {
      const suspended: string[] = [];
      for (const [name, decision] of Object.entries(manifest.ai?.decisions ?? {})) {
        const pinned = pinnedDecision(name);
        if (!pinned) continue;
        const exceeded = auditDriftExceeded({
          maxError: decision.autonomy?.maxError ?? 0.05,
          delta: decision.autonomy?.risk ?? 0.1,
          model: pinned.model,
          since: pinned.since,
          labels: await loadDecisionLabels(name),
        });
        const prev = decisionDriftSuspended(name);
        if (exceeded === prev) continue;
        setDecisionDrift(name, exceeded);
        persistDecisionDrift(name, exceeded, pinned.since);
        if (exceeded) suspended.push(name);
      }
      if (suspended.length === 0) return { suspended: decisionDriftNames() };
      await fx.emit({ name: DECISION_DRIFT_SIGNAL }, { suspended: true, decisions: suspended });
      return { suspended: decisionDriftNames() };
    },
  });
  adopt({
    trigger: { kind: "clock", name: "oke.decisions.drift" },
    flow: drift,
  });

  const candidate = flow("oke.decisions.candidate", {
    plane: "operator",
    do: async (input: { name?: string }, fx) => {
      if (!fx.operator.id) return fx.fail.unauthorized();
      const name = input.name ?? "";
      const body = await loadDecisionCandidate(name);
      if (!body) return fx.fail.notFound();
      return body;
    },
  });
  adopt({
    trigger: http.get("/_oke/decisions/:name/candidate").gate(decisionOperatorGate),
    flow: candidate,
  });

  const labels = flow("oke.decisions.labels", {
    plane: "operator",
    do: async (input: { name?: string; tenant?: string }, fx) => {
      if (!fx.operator.id) return fx.fail.unauthorized();
      const name = input.name ?? "";
      const requested = input.tenant;
      if (requested && requested !== (fx.tenant.id ?? null)) return fx.fail.notFound();
      const decl = aiDecisionRegistry.find((item) => item.name === name);
      const rows = await loadDecisionLabels(name, fx.tenant.id);
      const exported = exportDecisionLabels({
        labels: rows,
        callerTenant: fx.tenant.id,
        ...(requested !== undefined ? { requestedTenant: requested } : {}),
        fields: decisionExportFields(decl?.inputSchema),
      });
      if (!exported.ok) return fx.fail.notFound();
      return { lines: exported.lines };
    },
  });
  adopt({
    trigger: http.get("/_oke/decisions/:name/labels").gate(decisionOperatorGate),
    flow: labels,
  });
}

/**
 * Mark the app suspended and leave the flag for the monitor to emit.
 *
 * @param suspended - Drift detected
 */
export function noteDecisionDrift(name: string, suspended: boolean): void {
  setDecisionDrift(name, suspended);
}
