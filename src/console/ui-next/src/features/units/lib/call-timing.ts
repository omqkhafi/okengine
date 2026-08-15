/**
 * Call API duration chips — handler time vs browser round-trip.
 */

/** Which clock the primary chip shows. */
export type CallTimingKind = "handler" | "rtt";

/** Resolved Call API timing for the Response chrome. */
export type CallTiming = {
  readonly primaryMs: number;
  readonly primaryKind: CallTimingKind;
  readonly rttMs: number | null;
};

/**
 * Prefer host handler duration (same clock as Traces). Fall back to browser
 * RTT when the invoke payload has no `durationMs` (clock run-now).
 *
 * @param input - Handler ms from invoke + browser elapsed
 */
export function callTiming(input: {
  readonly handlerMs?: number | null;
  readonly rttMs: number | null;
}): CallTiming | null {
  const handler =
    input.handlerMs != null && Number.isFinite(input.handlerMs) ? input.handlerMs : null;
  if (handler !== null) {
    return { primaryMs: handler, primaryKind: "handler", rttMs: input.rttMs };
  }
  if (input.rttMs !== null && Number.isFinite(input.rttMs)) {
    return { primaryMs: input.rttMs, primaryKind: "rtt", rttMs: input.rttMs };
  }
  return null;
}
