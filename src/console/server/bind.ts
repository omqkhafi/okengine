/**
 * Local HTTP bindings that do not touch the global {@link on} registry.
 */

import {
  applyBoundaryContract,
  stampBoundaryContract,
} from "../../kernel/boundary-contract.ts";
import type { AnyFlowDef } from "../../kernel/flow.ts";
import type { Binding } from "../../kernel/on.ts";
import { normalizeTrigger, type HttpTrigger, type Trigger } from "../../kernel/triggers.ts";
import { consoleOperatorGate } from "./console-gates.ts";
import { PUBLIC_CONSOLE_FLOWS } from "./public-flows.ts";

/**
 * Bind an HTTP trigger to a flow without registering on the global `on` list.
 * Attaches `.public()` or {@link consoleOperatorGate} when the trigger
 * has no declared auth posture yet.
 *
 * @param trigger - HTTP trigger
 * @param flowDef - Flow definition
 */
export function bindHttp(trigger: HttpTrigger, flowDef: AnyFlowDef): Binding {
  const withPosture =
    trigger.gates.length > 0
      ? trigger
      : PUBLIC_CONSOLE_FLOWS.has(flowDef.name)
        ? trigger.public()
        : trigger.gate(consoleOperatorGate);
  const normalized = normalizeTrigger(withPosture);
  const list = flowDef.triggers as Trigger[];
  list.push(normalized);
  (flowDef as { $trigger: Trigger }).$trigger = normalized;
  if (normalized.kind === "http" && normalized.contract !== undefined) {
    applyBoundaryContract(flowDef, stampBoundaryContract(normalized.contract));
  }
  return { trigger: normalized, flow: flowDef };
}
