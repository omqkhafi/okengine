/**
 * `okengine/http` — slim HTTP app surface.
 *
 * Prefer this entry for HTTP-only apps so cold graphs stay on the edge
 * router and avoid the mega-barrel (`okengine/full`).
 *
 * @example
 * ```ts
 * import { on, flow, http, gate, oke, createBunRuntime } from "okengine/http";
 *
 * on(http.get("/").public(), flow("ping", { do: () => "Hi" }));
 * const app = oke({ name: "ping" });
 * createBunRuntime().serve(app);
 * ```
 *
 * @module
 */

export { on, listBindings, resetBindings, type Binding } from "./kernel/on.ts";
export { flow, isFlow, type FlowDef } from "./kernel/flow.ts";
export { http, internal } from "./kernel/triggers.ts";
export { clock } from "./elements/clock/declare.ts";
export { gate, GATE_PUBLIC_NAME } from "./elements/gate/declare.ts";
export { fail, type FlowFailure } from "./kernel/errors.ts";
export { isFlowFailure } from "./kernel/hooks.ts";
export { plugin, isPlugin, type PluginDef } from "./kernel/plugin.ts";
export { createBunRuntime, APP_PORT, type Runtime, type ServeOptions } from "./runtime/index.ts";
export type {
  OkeApp,
  OkeOptions,
  ReadyState,
  RegisteredFlowUnits,
  RoutesFromRegisteredUnits,
} from "./kernel/app.ts";
export { registerFlowUnits } from "./kernel/flow-units.ts";
export { stampFlowName, stampHttpPath } from "./kernel/stamp-http.ts";

import {
  oke as okeCore,
  type OkeApp,
  type OkeOptions,
  type RoutesFromRegisteredUnits,
} from "./kernel/app.ts";

/**
 * Create an HTTP-oriented app — defaults `router` to `"edge"` when omitted.
 *
 * @param options - Application options
 */
export function oke(
  options: OkeOptions & { readonly registry: "ignore" },
): OkeApp<Record<string, never>, Record<string, never>>;
export function oke(options: OkeOptions): OkeApp<{}, RoutesFromRegisteredUnits>;
export function oke(options: OkeOptions): OkeApp {
  return okeCore({
    ...options,
    router: options.router ?? "edge",
  });
}
