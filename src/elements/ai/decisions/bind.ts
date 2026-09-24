/**
 * Boot flows for decisions that declare autonomy: a clock aggregate,
 * a drift monitor, and the operator candidate endpoint.
 */

import { flow } from "../../../kernel/flow.ts";
import type { Binding } from "../../../kernel/on.ts";
import { http } from "../../../kernel/triggers.ts";
import type { Manifest } from "../../../manifest/types.ts";
import {
  aggregateDecisionCandidate,
  decisionDriftSuspended,
  getDecisionCandidate,
  setDecisionDrift,
} from "./certificate.ts";

/** Signal the drift monitor emits. The emit is declared on that flow. */
export const DECISION_DRIFT_SIGNAL = "oke/decision/drift";

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
      for (const name of names) aggregateDecisionCandidate(name);
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
      if (!decisionDriftSuspended()) return { suspended: false };
      await fx.emit({ name: DECISION_DRIFT_SIGNAL }, { suspended: true });
      return { suspended: true };
    },
  });
  adopt({
    trigger: { kind: "clock", name: "oke.decisions.drift" },
    flow: drift,
  });

  const candidate = flow("oke.decisions.candidate", {
    plane: "operator",
    do: async (input: { name?: string }, fx) => {
      const name = input.name ?? "";
      const body = getDecisionCandidate(name);
      if (!body) return fx.fail.notFound();
      return body;
    },
  });
  adopt({
    trigger: http.get("/_oke/decisions/:name/candidate"),
    flow: candidate,
  });
}

/**
 * Mark the app suspended and leave the flag for the monitor to emit.
 *
 * @param suspended - Drift detected
 */
export function noteDecisionDrift(suspended: boolean): void {
  setDecisionDrift(suspended);
}
