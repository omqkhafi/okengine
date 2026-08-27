/**
 * `http.resource` mount — kept off {@link ./triggers.ts} so edge `http.get`
 * apps do not pay for the five-verb CRUD helper.
 */

import { GATE_PUBLIC_NAME } from "../elements/gate/flatten.ts";
import {
  createGateAttach,
  createHttpTrigger,
  resourceMountBrand,
  type GateRef,
  type HttpMethod,
  type HttpTrigger,
  type ResourceFlowBag,
  type ResourceMount,
  type SignalSource,
} from "./triggers.ts";
import { registerPendingResourceLiveMount } from "./resource-live.ts";

/**
 * Mount a CRUD resource at `path`: `list`/`create` on the base, `get` /
 * `update` / `remove` on `/:id`. Bind via `on(http.resource(…))`.
 *
 * @param path - Base path (`/notes`)
 * @param ops - The five FlowDefs (usually `resource.all()`)
 * @param gates - Shared gate chain
 */
export function httpResource<P extends string>(
  path: P,
  ops: ResourceFlowBag,
  gates: readonly GateRef[] = [],
): ResourceMount {
  const id = `${path}/:id` as `${P}/:id`;
  const verb = <M extends HttpMethod>(method: M, p: P | `${P}/:id`): HttpTrigger<M> =>
    createHttpTrigger(method, p, gates);
  // Live exposure — synthesized from the resource's live surface so SSE
  // rides the same gates as the CRUD verbs.
  const liveFlow = (ops as { readonly live?: { readonly signal: string; readonly flow: unknown } })
    .live;
  // `store.resource(…, { live: omitted })` puts a pending surface on the ops
  // bag. `http.resource` records the mount slot; `oke()` drains it only when
  // the project-wide `store.live` flag is on.
  const pendingSignal = (ops as { readonly pendingLive?: { readonly signalName: string } })
    .pendingLive?.signalName;
  if (pendingSignal !== undefined && liveFlow === undefined) {
    registerPendingResourceLiveMount({ path, gates, signalName: pendingSignal });
  }
  const mounts = [
    { trigger: verb("GET", path), flow: ops.list },
    { trigger: verb("POST", path), flow: ops.create },
    { trigger: verb("GET", id), flow: ops.get },
    { trigger: verb("PATCH", id), flow: ops.update },
    { trigger: verb("DELETE", id), flow: ops.remove },
    ...(liveFlow !== undefined
      ? [
          {
            trigger: createHttpTrigger("GET" as const, `${path}/live`, gates, {
              name: liveFlow.signal,
            } as SignalSource),
            flow: liveFlow.flow,
          },
        ]
      : []),
  ];
  const mount: ResourceMount = {
    [resourceMountBrand]: true,
    gates,
    ...(liveFlow !== undefined ? { live: { signal: liveFlow.signal, flow: liveFlow.flow } } : {}),
    mounts,
    gate: createGateAttach((next) => httpResource(path, ops, next), gates),
    public() {
      return httpResource(path, ops, [...gates, GATE_PUBLIC_NAME]);
    },
  };
  return mount;
}
