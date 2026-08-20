/**
 * Count `ask` effects in the runs buffer — timing-only, never dollars.
 */

import type { RunRow } from "@/client.ts";
import { parseMcpToolRef } from "../../../../../../manifest/mcp-ref.ts";
import { runsInWindow } from "./window-stats.ts";

/** Honest empty — no ask effects in the window. */
export type AskCountEmpty = {
  readonly kind: "empty";
};

/** Real ask-effect count. */
export type AskCountSummary = {
  readonly kind: "summary";
  readonly asks: number;
  readonly windowMs: number;
};

/** Ask-count projection. */
export type AskCount = AskCountEmpty | AskCountSummary;

/**
 * Count effect entries with `kind === "ask"` in the window.
 *
 * @param runs - Full runs buffer
 * @param nowMs - Clock
 * @param windowMs - Lookback
 */
export function askCountInWindow(
  runs: readonly RunRow[],
  nowMs: number,
  windowMs: number,
): AskCount {
  const inWindow = runsInWindow(runs, nowMs, windowMs);
  let asks = 0;
  for (const run of inWindow) {
    for (const effect of run.effects) {
      if (effect.kind === "ask" || (effect.kind === "call" && parseMcpToolRef(effect.resource))) {
        asks += 1;
      }
    }
  }
  if (asks === 0) return { kind: "empty" };
  return { kind: "summary", asks, windowMs };
}
