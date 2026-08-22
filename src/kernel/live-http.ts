/**
 * Live HTTP helpers — path params, auto-match, exposure uniqueness, synthesis.
 */

import type { SignalDecl } from "../elements/signal/declare.ts";
import type { SignalResourceRef } from "../manifest/types.ts";
import type { Fx } from "./fx.ts";
import { flow, type AnyFlowDef } from "./flow.ts";
import type { GateRef, SignalSource } from "./triggers.ts";

/** Default GET path for {@link http.live}. */
export const LIVE_HTTP_PREFIX = "/_oke/live/";

/**
 * Default HTTP path for a live-signal firehose.
 *
 * @param signalName - Signal name
 */
export function liveHttpPath(signalName: string): string {
  return `${LIVE_HTTP_PREFIX}${encodeURIComponent(signalName)}`;
}

/**
 * `:param` names on an HTTP path template, first occurrence order.
 *
 * @param path - Route path
 */
export function httpPathParams(path: string): string[] {
  const names: string[] = [];
  const re = /:([A-Za-z_][\w]*)/g;
  let match: RegExpExecArray | null = re.exec(path);
  while (match) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
    match = re.exec(path);
  }
  return names;
}

/**
 * Sorted auto-match field list joined for uniqueness (`""` = firehose).
 *
 * @param path - HTTP path template
 */
export function liveMatchKeyFromPath(path: string): string {
  return httpPathParams(path).toSorted().join(",");
}

/**
 * Sorted flattened gate names (`public` included).
 *
 * @param gates - Trigger gates
 */
export function liveGatesKey(gates: readonly GateRef[]): string {
  return gates
    .map((g) => (typeof g === "string" ? g : g.name))
    .toSorted()
    .join(",");
}

/**
 * Boot uniqueness key: `(signalName, gatesKey, matchKey)`.
 *
 * @param signalName - Signal name
 * @param gatesKey - {@link liveGatesKey}
 * @param matchKey - {@link liveMatchKeyFromPath} or `custom:{flow}`
 */
export function liveExposureKey(signalName: string, gatesKey: string, matchKey: string): string {
  return `${signalName}\0${gatesKey}\0${matchKey}`;
}

/**
 * Auto-match: payload fields equal same-named input fields.
 *
 * @param payload - Signal payload
 * @param input - HTTP input (path params)
 * @param fields - Field names (path params)
 */
export function payloadAutoMatch(
  payload: unknown,
  input: unknown,
  fields: readonly string[],
): boolean {
  if (fields.length === 0) return true;
  if (payload === null || typeof payload !== "object") return true;
  const row = payload as Record<string, unknown>;
  const params =
    input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  for (const key of fields) {
    if (!(key in row)) continue;
    if (row[key] !== params[key]) return false;
  }
  return true;
}

/**
 * Synthesize a stream Flow for `on(http.get(path).live(signal))`.
 *
 * @param signal - Live signal handle
 * @param path - HTTP path (auto-match keys)
 */
export function synthesizeLiveFlow(signal: SignalSource, path: string): AnyFlowDef {
  const fields = httpPathParams(path);
  const name = signal.name;
  const schema = "schema" in signal ? (signal as SignalDecl).schema : undefined;
  return flow({
    effects: { reads: [`signal:${name}` as SignalResourceRef] },
    ...(schema !== undefined ? { out: schema } : {}),
    do: (input, fx: Fx) =>
      fx.live(signal, {
        match: (payload) => payloadAutoMatch(payload, input, fields),
      }),
  });
}
