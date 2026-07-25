/**
 * Honest sampling labels + full-trace escape hatch (console §9.3).
 *
 * Sampling is stated in the list (10% + all errors) with a
 * "trace this flow fully for 10 minutes" override.
 */

/** Default sampling policy shown in the list header. */
export const DEFAULT_SAMPLING_LABEL = "10% + all errors";

/** Full-trace boost window (10 minutes). */
export const FULL_TRACE_BOOST_MS = 10 * 60 * 1000;

/** Active boost for one flow. */
export interface FullTraceBoost {
  /** Flow name. */
  readonly flow: string;
  /** Epoch-ms when the boost expires. */
  readonly until: number;
}

/**
 * Sampling line for the list header, including active boosts.
 *
 * @param boosts - Active boosts
 * @param now - Clock
 */
export function samplingLabel(
  boosts: readonly FullTraceBoost[],
  now: number = Date.now(),
): string {
  const live = boosts.filter((b) => b.until > now);
  if (live.length === 0) return DEFAULT_SAMPLING_LABEL;
  const flows = live.map((b) => b.flow).join(", ");
  return `${DEFAULT_SAMPLING_LABEL} · full: ${flows}`;
}

/**
 * Create / refresh a 10-minute full-trace boost for a flow.
 *
 * @param boosts - Existing boosts
 * @param flow - Flow to boost
 * @param now - Clock
 */
export function boostFlowFully(
  boosts: readonly FullTraceBoost[],
  flow: string,
  now: number = Date.now(),
): FullTraceBoost[] {
  const until = now + FULL_TRACE_BOOST_MS;
  const rest = boosts.filter((b) => b.flow !== flow && b.until > now);
  return [...rest, { flow, until }];
}

/**
 * Prune expired boosts.
 *
 * @param boosts - Boosts
 * @param now - Clock
 */
export function pruneBoosts(
  boosts: readonly FullTraceBoost[],
  now: number = Date.now(),
): FullTraceBoost[] {
  return boosts.filter((b) => b.until > now);
}
