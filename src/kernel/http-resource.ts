/**
 * `http.resource` mount — kept off {@link ./triggers.ts} so edge `http.get`
 * apps do not pay for the five-verb CRUD helper.
 */

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
 * @param isLive - Live on GET list + get
 */
export function httpResource<P extends string>(
  path: P,
  ops: ResourceFlowBag,
  gates: readonly GateRef[] = [],
  isLive = false,
): ResourceMount {
  const id = `${path}/:id` as `${P}/:id`;
  const verb = <M extends HttpMethod>(
    method: M,
    p: P | `${P}/:id`,
    live: boolean,
  ): HttpTrigger<M> => createHttpTrigger(method, p, gates, live);
  const mount: ResourceMount = {
    [resourceMountBrand]: true,
    gates,
    isLive,
    mounts: [
      { trigger: verb("GET", path, isLive), flow: ops.list },
      { trigger: verb("POST", path, false), flow: ops.create },
      { trigger: verb("GET", id, isLive), flow: ops.get },
      { trigger: verb("PATCH", id, false), flow: ops.update },
      { trigger: verb("DELETE", id, false), flow: ops.remove },
    ],
    gate: createGateAttach((next) => httpResource(path, ops, next, isLive), gates),
    live() {
      return httpResource(path, ops, gates, true);
    },
  };
  return mount;
}
