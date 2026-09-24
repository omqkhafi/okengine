/**
 * Eager live and stream route tables.
 *
 * `createClient` flattens these at construction. The SSE pumps
 * (`subscribeLive`, `openStream`) stay in lazy chunks.
 *
 * @module
 */

import type { ClientRouteMap, FlowContract, LiveHandlers } from "./types.ts";
import { methodAndPath, walkContracts } from "./wire.ts";

/** One HTTP exposure of a live signal. */
export interface LiveExposure {
  readonly flow: string;
  readonly method: string;
  readonly path: string;
  readonly matchKey: readonly string[];
}

/** Signal name → exposures (multiple audiences). */
export type LiveRouteTable = Readonly<Record<string, readonly LiveExposure[]>>;

/** Flow id (`unit.flow`) → exposure. */
export type LiveByFlow = Readonly<Record<string, LiveExposure>>;

/** Flow id → REST route for stream-only (non-live) SSE. */
export type StreamByFlow = Readonly<
  Record<string, { readonly method: string; readonly path: string }>
>;

/**
 * Build live route tables from `app.$routes`.
 *
 * @param $routes - Runtime route map
 */
export function flattenLiveRoutes($routes: ClientRouteMap | undefined): {
  readonly bySignal: LiveRouteTable;
  readonly byFlow: LiveByFlow;
} {
  const bySignal: Record<string, LiveExposure[]> = {};
  const byFlow: Record<string, LiveExposure> = {};
  walkContracts($routes, (unit, flow, contract) => {
    const live = liveName(contract);
    const route = methodAndPath(contract);
    if (typeof live !== "string" || !route) return;
    const matchKey = matchKeyOf(contract);
    const id = `${unit}.${flow}`;
    const exposure: LiveExposure = { flow: id, method: route.method, path: route.path, matchKey };
    (bySignal[live] ??= []).push(exposure);
    byFlow[id] = exposure;
  });
  return { bySignal, byFlow };
}

function liveName(contract: FlowContract): string | undefined {
  return "live" in contract && typeof contract.live === "string" ? contract.live : undefined;
}

function matchKeyOf(contract: FlowContract): readonly string[] {
  if ("matchKey" in contract && Array.isArray(contract.matchKey)) {
    return contract.matchKey.filter((k): k is string => typeof k === "string");
  }
  return [];
}

/** True when `value` is a handlers bag (`onEvent` present). */
export function isLiveHandlers(value: unknown): value is LiveHandlers<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LiveHandlers<unknown>).onEvent === "function"
  );
}

/**
 * Pick the unique exposure whose `matchKey` is a subset of `input` keys.
 * Prefer the largest matchKey. Ties require `via`.
 *
 * @param exposures - All exposures for one signal
 * @param input - Filter fields
 * @param via - `unit.flow` disambiguator
 */
export function pickLiveExposure(
  exposures: readonly LiveExposure[],
  input: unknown,
  via?: string,
): LiveExposure {
  if (via) {
    const hit = exposures.find((e) => e.flow === via);
    if (!hit) throw new Error(`Unknown live via "${via}"`);
    return hit;
  }
  const keys =
    input !== null && typeof input === "object"
      ? Object.keys(input as Record<string, unknown>)
      : [];
  const candidates = exposures.filter((e) => e.matchKey.every((k) => keys.includes(k)));
  if (candidates.length === 0) {
    throw new Error(`No live exposure matches input keys [${keys.join(", ")}]`);
  }
  const max = Math.max(...candidates.map((e) => e.matchKey.length));
  const top = candidates.filter((e) => e.matchKey.length === max);
  if (top.length !== 1) {
    throw new Error(`Multiple live exposures match. Pass via: "unit.flow".`);
  }
  return top[0]!;
}

/**
 * Collect `stream: true` routes that are not live exposures.
 *
 * @param $routes - Runtime route map
 */
export function flattenStreamRoutes($routes: ClientRouteMap | undefined): StreamByFlow {
  const out: Record<string, { readonly method: string; readonly path: string }> = {};
  walkContracts($routes, (unit, flow, contract) => {
    if (!("stream" in contract) || contract.stream !== true) return;
    if ("live" in contract && typeof contract.live === "string") return;
    const route = methodAndPath(contract);
    if (route) out[`${unit}.${flow}`] = route;
  });
  return out;
}
