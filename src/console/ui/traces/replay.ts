/**
 * Replay governed by reversibility (console §9.3 · §9.1 · §10.5).
 *
 * A trace containing an external effect offers a dry run with external
 * effects stubbed — never a silent re-send of email / charge.
 */

import { traceHasExternal } from "./tier.ts";
import type { TraceSpan } from "./types.ts";

/** Replay decision for a connected trace. */
export type ReplayDecision =
  | { readonly mode: "replay" }
  | {
      readonly mode: "dry-run";
      readonly reason: string;
    };

/**
 * Decide how Replay may proceed for the open trace.
 *
 * @param spans - Connected spans
 */
export function replayDecision(
  spans: readonly TraceSpan[],
): ReplayDecision {
  if (traceHasExternal(spans)) {
    return {
      mode: "dry-run",
      reason:
        "This trace contains an external effect. Replay runs as a dry run with external effects stubbed.",
    };
  }
  return { mode: "replay" };
}
