/**
 * Published budget limits — AGENTS.md / unified-theory §24 / console §7.
 *
 * A regression fails okengine's own build. Claims we cannot measure, we do not make.
 */

/** Kernel (edge profile) — gzipped minified bundle. */
export const KERNEL_EDGE_BUDGET_BYTES = 16 * 1024;

/** Client runtime — gzipped minified bundle. */
export const CLIENT_BUDGET_BYTES = 4 * 1024;

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
