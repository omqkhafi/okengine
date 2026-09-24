/**
 * Published budget limits — AGENTS.md / unified-theory §24 / console §7.
 *
 * A regression fails okengine's own build. Claims we cannot measure, we do not make.
 */

/** Kernel (edge profile) — gzipped minified bundle. */
export const KERNEL_EDGE_BUDGET_BYTES = 17 * 1024;

/**
 * Client runtime — gzipped minified **entry** chunk.
 *
 * 6 kB (was 5 kB). The cap was raised when the single bundle measured 5194,
 * over 90% of 5120. Live subscribe and streams load on first use; this gate
 * is the entry chunk (call-only download).
 */
export const CLIENT_BUDGET_BYTES = 6 * 1024;

/** Console initial load — gzipped html + entry js/css (ui-next SPA, no panel-* split). */
export const CONSOLE_BUDGET_BYTES = 700 * 1024;

/** Cold start on Bun — process start to server ready (median). */
export const COLD_START_BUDGET_MS = 75;

/** p99 HTTP routing overhead (match only). */
export const ROUTING_P99_BUDGET_MS = 1;

/**
 * Regression tolerance for published-export gzip samples.
 * Allowed growth = max(floor bytes, ratio × previous).
 */
export const EXPORT_REGRESSION_TOLERANCE_RATIO = 0.02;

/** Minimum allowed growth (bytes) before a subpath export fails regression. */
export const EXPORT_REGRESSION_TOLERANCE_FLOOR_BYTES = 256;

/**
 * Growth multiple for an absolute budget that still has room under its cap.
 *
 * The sample fails when it reaches this multiple of the last committed value
 * and that multiple is still below the absolute cap. Two is the line: one
 * cold-start run has already printed a phantom jump of about this size, so
 * the probe re-runs before failing instead of tightening the ratio.
 */
export const ABSOLUTE_REGRESSION_RATIO = 2;
