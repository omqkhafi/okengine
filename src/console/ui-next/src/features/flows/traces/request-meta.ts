/**
 * Derive REQUEST section method/path (or trigger label) from Manifest + run.
 */

import type { Flow, Manifest } from "../../../../../../manifest/types.ts";

/** Request line shown above the input snapshot. */
export type TraceRequestMeta = {
  /** HTTP method when the flow has an `http` trigger. */
  readonly method: string | null;
  /** HTTP path when the flow has an `http` trigger. */
  readonly path: string | null;
  /** Single-line display, e.g. `"POST /bookings"` or `"Signal · order-placed"`. */
  readonly headline: string;
};

/**
 * Resolve request metadata for a run from Manifest flow trigger shape.
 *
 * HTTP → method + path from `flow.trigger.http`.
 * Signal / cron / every / cdc → kind-specific headline (no invented path).
 * Missing flow → fall back to the run's trigger string.
 *
 * @param manifest - Live Manifest (may be null while loading)
 * @param flowId - Run's flow name
 * @param trigger - WideEvent trigger kind string
 */
export function traceRequestMeta(
  manifest: Manifest | null | undefined,
  flowId: string,
  trigger: string,
): TraceRequestMeta {
  const flow: Flow | undefined = manifest?.flows?.[flowId];
  const t = flow?.trigger;

  if (t?.http) {
    return {
      method: t.http.method,
      path: t.http.path,
      headline: `${t.http.method} ${t.http.path}`,
    };
  }
  if (t?.signal) {
    return { method: null, path: null, headline: `Signal · ${t.signal}` };
  }
  if (t?.cron) {
    return { method: null, path: null, headline: `Cron · ${t.cron}` };
  }
  if (t?.every) {
    return { method: null, path: null, headline: `Every · ${t.every}` };
  }
  if (t?.cdc) {
    return { method: null, path: null, headline: `CDC · ${t.cdc.table}` };
  }
  if (trigger === "http") {
    return { method: null, path: null, headline: "HTTP" };
  }
  if (trigger === "internal" || !flow?.trigger) {
    return { method: null, path: null, headline: "Call-only" };
  }
  return { method: null, path: null, headline: trigger };
}
