/**
 * Typed element-layer classification for architecture edges (console §9.13).
 *
 * Layers toggle real edge kinds — Store / Signal / Clock / Channel+AI —
 * not visual grouping of an undifferentiated graph.
 */

import type { CauseNode } from "../flows/graph.ts";
import type { ElementLayer } from "./types.ts";

/**
 * Classify a causality effect ref into a toggleable element layer.
 *
 * Returns `null` for secrets and flow portals (not among the four layers).
 *
 * @param ref - Effect ref (`sql:bookings`, `signal:order-placed`, …)
 */
export function layerOfEffectRef(ref: string): ElementLayer | null {
  if (
    ref.startsWith("sql:") ||
    ref.startsWith("kv:") ||
    ref.startsWith("files:") ||
    ref.startsWith("index:")
  ) {
    return "data";
  }
  if (ref.startsWith("signal:")) return "messaging";
  if (ref.startsWith("channel:") || ref.startsWith("ai:")) return "external";
  return null;
}

/**
 * Classify a cause into a toggleable element layer.
 *
 * HTTP / CDC / caller causes are structural (always shown when relevant);
 * signal → messaging; cron / every → time.
 *
 * @param cause - Cause node from the causality graph
 */
export function layerOfCause(cause: CauseNode): ElementLayer | null {
  if (cause.kind === "signal") return "messaging";
  if (cause.kind === "cron" || cause.kind === "every") return "time";
  return null;
}

/**
 * Whether a resource ref sits outside the system boundary
 * (Channel / AI — irreversible tier).
 *
 * @param ref - Effect ref
 */
export function isBoundaryExternal(ref: string): boolean {
  return ref.startsWith("channel:") || ref.startsWith("ai:");
}

/**
 * Strip a kind prefix for display (`channel:booking-confirmed` → `booking-confirmed`).
 *
 * @param ref - Effect ref
 */
export function labelOfRef(ref: string): string {
  const i = ref.indexOf(":");
  return i === -1 ? ref : ref.slice(i + 1);
}
