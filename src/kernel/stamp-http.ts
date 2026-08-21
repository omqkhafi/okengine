/**
 * In-place HTTP path + Flow name stamps.
 *
 * `on()` already registered the trigger (possibly still on the pending-path
 * sentinel). A wrapper that returned a new trigger would leave `listBindings()`
 * on the sentinel — mutate the existing object.
 */

import { isFlow, type AnyFlowDef, type FlowDef } from "./flow.ts";
import { isPendingHttpPath, type HttpPathPending } from "./http-path-pending.ts";
import type { HttpTrigger, Trigger } from "./triggers.ts";

/**
 * Replace a pending HTTP path on {@link FlowDef} with the file-tree stamp.
 *
 * Explicit `http.get("/x")` wins — the pending sentinel is the only path
 * this function overwrites. Returns the same object with a tighter trigger
 * type when the original path was pending.
 *
 * @param flow - Bound flow (already passed through `on()`)
 * @param path - Inferred URL (`/notes/:id`)
 */
export function stampHttpPath<F extends AnyFlowDef, P extends string>(
  flow: F,
  path: P,
): StampHttpPath<F, P> {
  if (!isFlow(flow)) return flow as StampHttpPath<F, P>;
  const apply = (trigger: Trigger): void => {
    if (trigger.kind !== "http") return;
    if (!isPendingHttpPath(trigger.path)) return;
    (trigger as { path: string }).path = path;
  };
  if (flow.$trigger) apply(flow.$trigger);
  for (const trigger of flow.triggers) apply(trigger);
  return flow as StampHttpPath<F, P>;
}

/**
 * Stamp `unit.export` onto a nameless (or `flow_*`) Flow.
 *
 * Explicit `flow("notes.get")` wins. Fills `unit` when missing.
 *
 * @param flow - Flow definition
 * @param name - `notes.get`
 */
export function stampFlowName<F extends AnyFlowDef>(flow: F, name: string): F {
  if (!isFlow(flow)) return flow;
  const f = flow as { name: string; unit: string | undefined };
  if (!f.name || f.name.startsWith("flow_")) {
    f.name = name;
  }
  if (!f.unit) {
    const resolved = f.name || name;
    const dot = resolved.indexOf(".");
    f.unit = dot > 0 ? resolved.slice(0, dot) : resolved;
  }
  return flow;
}

/**
 * Type-level path replacement — only when the bound trigger is still pending.
 *
 * @typeParam F - Flow definition
 * @typeParam P - Stamped path
 */
export type StampHttpPath<F, P extends string> =
  F extends FlowDef<infer I, infer O, infer E, infer D, infer T>
    ? T extends HttpTrigger<infer M, infer Cur>
      ? [Cur] extends [HttpPathPending]
        ? FlowDef<I, O, E, D, HttpTrigger<M, P>>
        : F
      : F
    : F;

export { HTTP_PATH_PENDING, isPendingHttpPath } from "./http-path-pending.ts";
