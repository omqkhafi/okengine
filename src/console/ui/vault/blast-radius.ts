/**
 * Format journal-queried rotation blast radius for the Vault panel.
 */

import type { VaultBlastRadius } from "./types.ts";

/** Human-readable blast-radius line. */
export interface BlastRadiusLine {
  readonly summary: string;
  readonly detail: string | null;
  readonly warn: boolean;
}

/**
 * Format blast radius for display.
 *
 * @param blast - Queried radius
 */
export function formatBlastRadius(blast: VaultBlastRadius): BlastRadiusLine {
  if (blast.count === 0) {
    return {
      summary: "No in-flight durable runs hold this secret",
      detail: null,
      warn: false,
    };
  }
  const remaining =
    blast.longestOutstandingMs != null ? formatDuration(blast.longestOutstandingMs) : null;
  return {
    summary: `${blast.count} in-flight durable run(s) will wake holding a new key`,
    detail: remaining
      ? `Longest outstanding wake in ${remaining}`
      : blast.longestWakeAt != null
        ? `Longest wake at ${new Date(blast.longestWakeAt).toISOString()}`
        : null,
    warn: true,
  };
}

/**
 * @param ms - Duration
 */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  const sec = Math.floor(ms / 1_000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  const days = Math.floor(hr / 24);
  return `${days}d`;
}
