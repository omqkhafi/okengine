/**
 * Project-wide `store.live` default — deferred live-query mounts.
 *
 * `oke({ store: { live: true } })` flips the default posture for NEW
 * `store.schema.table()` declarations to live-by-default. `store.resource`
 * and `http.resource` both run at module evaluation, before `oke()` is
 * constructed, so the flag is not yet known when they execute. This module
 * records their pending live surfaces and mount slots; the `oke()`
 * constructor drains them and adopts the synthesized `GET <path>/live`
 * bindings only when the flag is on. When the flag is off, the pending
 * entries are discarded — 100% of today's explicit-only behavior.
 *
 * Declaration ergonomics only: draining mounts the same
 * `store.resource({ live: true })` live surface. It never changes the
 * underlying CDC / RLS-per-event cost model.
 */

import { createHttpTrigger, type GateRef } from "./triggers.ts";
import type { AnyFlowDef } from "./flow.ts";
import type { Binding } from "./on.ts";

/** Marker placed on resource ops bags whose live surface is flag-dependent. */
export const PENDING_RESOURCE_LIVE: unique symbol = Symbol.for("oke.resource.pending-live");

/** A lazily-built live surface for a resource whose `live` was omitted. */
export interface PendingResourceLive {
  /** Signal name — `oke/live/sql:<table>`. */
  readonly signalName: string;
  /** Resource definition to stamp `live` onto when the flag resolves on. */
  readonly def: object;
  /** Ops bag (`resource.all()`) to stamp `live` onto when resolved on. */
  readonly bag: object;
  /** Build the surface on demand (never called when the flag stays off). */
  readonly build: () => { readonly signal: string; readonly flow: AnyFlowDef };
}

/** Mount slot left by `http.resource` for a resource with a pending surface. */
export interface PendingResourceLiveMount {
  readonly path: string;
  readonly gates: readonly GateRef[];
  readonly signalName: string;
}

const pendingSurfaces = new Map<string, PendingResourceLive>();
const pendingMounts = new Map<string, PendingResourceLiveMount>();

/**
 * Record a resource whose `live` was omitted (flag-dependent).
 *
 * @param surface - Pending live surface
 */
export function registerPendingResourceLive(surface: PendingResourceLive): void {
  pendingSurfaces.set(surface.signalName, surface);
}

/**
 * Record a `http.resource(path, ops)` mount slot whose ops bag carries a
 * pending live surface. Keyed by path so gate-chaining rebuilds overwrite
 * earlier partial-gate registrations.
 *
 * @param mount - Path, gates, and the pending surface's signal name
 */
export function registerPendingResourceLiveMount(mount: PendingResourceLiveMount): void {
  pendingMounts.set(mount.path, mount);
}

/**
 * Resolve every pending mount. Always clears the pending state; bindings
 * are only emitted (and surfaces built) when `enabled` is true.
 *
 * @param enabled - Whether the project-wide `store.live` default is on
 * @param adopt - Adopt one binding (`oke`'s `adoptBinding`)
 * @returns The adopted bindings (empty when the flag is off)
 */
export function drainPendingResourceLiveMounts(
  enabled: boolean,
  adopt: (binding: Binding) => void,
): Binding[] {
  const mounts = [...pendingMounts.values()];
  pendingMounts.clear();
  const adopted: Binding[] = [];
  if (!enabled) {
    pendingSurfaces.clear();
    return adopted;
  }
  for (const mount of mounts) {
    const surface = pendingSurfaces.get(mount.signalName);
    if (!surface) continue;
    const built = surface.build();
    const liveFlow = built.flow as AnyFlowDef & { live?: string };
    // Match what `on(http.get(...).live(signal), flow)` stamps on the flow —
    // `flow.live` is the signal name the Manifest / client tooling reads.
    liveFlow.live = mount.signalName;
    // Stamp the resolved surface onto the resource + bag so post-construction
    // `resource.live` reads are precise per object (never a global flag).
    Object.defineProperty(surface.def, "live", { value: built, configurable: true });
    Object.defineProperty(surface.bag, "live", { value: built, configurable: true });
    const binding: Binding = {
      trigger: createHttpTrigger("GET", `${mount.path}/live`, mount.gates, {
        name: mount.signalName,
      }),
      flow: built.flow,
    };
    adopt(binding);
    adopted.push(binding);
  }
  pendingSurfaces.clear();
  return adopted;
}

/**
 * Clear pending live state without draining (test reset).
 */
export function resetPendingResourceLive(): void {
  pendingMounts.clear();
  pendingSurfaces.clear();
}
