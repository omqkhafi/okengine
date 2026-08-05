/**
 * Optional OTLP metrics export shape — additive sink for WideEvents.
 *
 * Not a prerequisite for native alerting (Runs + Clock + Channel).
 * Protocol-named (`otlp`); vendor choice stays in config / images.
 */

import type { WideEvent } from "./types.ts";

/** One OTLP-shaped metric datapoint derived from a wide event. */
export interface OtlpRunMetric {
  readonly name: "oke.runs" | "oke.run.duration_ms";
  readonly kind: "counter" | "histogram";
  readonly value: number;
  readonly attributes: Readonly<Record<string, string>>;
  readonly timeUnixMs: number;
}

/**
 * Map a WideEvent onto OTLP-friendly metric datapoints.
 *
 * @param event - Appended run
 */
export function wideEventToOtlpMetrics(event: WideEvent): readonly OtlpRunMetric[] {
  const attributes = {
    flow: event.flow,
    trigger: event.trigger,
    outcome: event.error ? "error" : "ok",
    ...(event.error ? { error_code: event.error.code } : {}),
  };
  return [
    {
      name: "oke.runs",
      kind: "counter",
      value: 1,
      attributes,
      timeUnixMs: event.endedAt,
    },
    {
      name: "oke.run.duration_ms",
      kind: "histogram",
      value: event.durationMs,
      attributes: { flow: event.flow, trigger: event.trigger },
      timeUnixMs: event.endedAt,
    },
  ];
}

/** Pluggable sink for teams with an existing Grafana / Datadog stack. */
export type OtlpMetricsSink = (metrics: readonly OtlpRunMetric[]) => void | Promise<void>;

/**
 * Fan-out helper: call after `runs.record` when an OTLP sink is configured.
 *
 * @param event - Just-recorded wide event
 * @param sink - Optional exporter
 */
export async function exportRunMetrics(
  event: WideEvent,
  sink: OtlpMetricsSink | undefined,
): Promise<void> {
  if (!sink) return;
  await sink(wideEventToOtlpMetrics(event));
}
