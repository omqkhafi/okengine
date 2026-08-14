/**
 * Right-slot copy for a trace row — always relative time.
 * Failure stays on the rail / dot; hover title still carries the error.
 */

import type { RunRow } from "@/client.ts";

/** Fields {@link traceRowMeta} reads from a run. */
export type TraceRowMetaRun = Pick<RunRow, "error" | "errorMessage" | "startedAt">;

/** Right-slot label + tooltip for {@link TraceRow}. */
export type TraceRowMeta = {
  readonly text: string;
  readonly title: string;
  readonly failed: boolean;
};

/**
 * Relative clock for a successful run (`23m ago`).
 *
 * @param startedAt - Run start (ms)
 * @param now - Clock (ms); inject in tests
 */
export function relativeTime(startedAt: number, now: number = Date.now()): string {
  const delta = now - startedAt;
  if (delta < 1_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1_000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

/**
 * Right-column text: relative time for every run.
 *
 * @param run - Run error + start
 * @param now - Clock (ms); inject in tests
 */
export function traceRowMeta(run: TraceRowMetaRun, now: number = Date.now()): TraceRowMeta {
  const text = relativeTime(run.startedAt, now);
  const failed = run.error !== null;
  const title = failed
    ? run.errorMessage
      ? `${run.error} — ${run.errorMessage}`
      : (run.error ?? text)
    : text;
  return { text, title, failed };
}
