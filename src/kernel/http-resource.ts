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
} from "./triggers.ts";

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
  const mount: ResourceMount = {
    [resourceMountBrand]: true,
    gates,
    mounts: [
      { trigger: verb("GET", path), flow: ops.list },
      { trigger: verb("POST", path), flow: ops.create },
      { trigger: verb("GET", id), flow: ops.get },
      { trigger: verb("PATCH", id), flow: ops.update },
      { trigger: verb("DELETE", id), flow: ops.remove },
    ],
    gate: createGateAttach((next) => httpResource(path, ops, next), gates),
    public() {
      return httpResource(path, ops, [...gates, GATE_PUBLIC_NAME]);
    },
  };
  return mount;
}
