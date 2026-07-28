/**
 * Local HTTP bindings that do not touch the global {@link on} registry.
 */

import type { AnyFlowDef } from "../../kernel/flow.ts";
import type { Binding } from "../../kernel/on.ts";
import { normalizeTrigger, type HttpTrigger, type Trigger } from "../../kernel/triggers.ts";

/**
 * Bind an HTTP trigger to a flow without registering on the global `on` list.
 *
 * @param trigger - HTTP trigger
 * @param flowDef - Flow definition
 */
export function bindHttp(trigger: HttpTrigger, flowDef: AnyFlowDef): Binding {
  const normalized = normalizeTrigger(trigger);
  const list = flowDef.triggers as Trigger[];
  list.push(normalized);
  (flowDef as { $trigger: Trigger }).$trigger = normalized;
  return { trigger: normalized, flow: flowDef };
}
