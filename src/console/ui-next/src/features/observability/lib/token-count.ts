/**
 * Window token totals from stamped RunRows — never invent zeros.
 */

import type { RunRow } from "@/client.ts";
import { runsInWindow } from "./window-stats.ts";

/** Honest empty — no token samples in the window. */
export type TokenCountEmpty = {
  readonly kind: "empty";
};

/** Real token totals from runs that stamped driver-reported counts. */
export type TokenCountSummary = {
  readonly kind: "summary";
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly windowMs: number;
};

/** Token-count projection. */
export type TokenCount = TokenCountEmpty | TokenCountSummary;

/**
 * Sum `inputTokens` / `outputTokens` on windowed runs.
 *
 * Null / zero fields are skipped. Empty when both sums stay 0.
 *
 * @param runs - Full runs buffer
 * @param nowMs - Clock
 * @param windowMs - Lookback
 */
export function tokenCountInWindow(
  runs: readonly RunRow[],
  nowMs: number,
  windowMs: number,
): TokenCount {
  const inWindow = runsInWindow(runs, nowMs, windowMs);
  let inputTokens = 0;
  let outputTokens = 0;
  for (const run of inWindow) {
    if (run.inputTokens !== null && run.inputTokens > 0) inputTokens += run.inputTokens;
    if (run.outputTokens !== null && run.outputTokens > 0) outputTokens += run.outputTokens;
  }
  if (inputTokens === 0 && outputTokens === 0) return { kind: "empty" };
  return { kind: "summary", inputTokens, outputTokens, windowMs };
}

/**
 * Compact token count for the AI rail.
 *
 * @param value - Positive token total
 */
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

/**
 * Rail copy for a token summary — omits a side when that total is 0.
 *
 * @param tokens - Window summary
 */
export function formatTokenRail(tokens: TokenCountSummary): string | null {
  const parts: string[] = [];
  if (tokens.inputTokens > 0) parts.push(`${formatTokenCount(tokens.inputTokens)} in`);
  if (tokens.outputTokens > 0) parts.push(`${formatTokenCount(tokens.outputTokens)} out`);
  return parts.length === 0 ? null : parts.join(" · ");
}
