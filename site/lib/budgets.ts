/**
 * Measured CI budgets from the monorepo root `budgets.json`.
 * Landing visuals read these numbers — never invent sizes or timings.
 */

import raw from "../../budgets.json";
import {
  OFFICIAL_PLUGIN_BUDGETS,
  PLUGIN_BUDGET_CATEGORIES,
  type OfficialPluginBudget,
  type PluginBudgetCategory,
} from "../../src/release/official-plugins";

export {
  OFFICIAL_PLUGIN_BUDGETS,
  PLUGIN_BUDGET_CATEGORIES,
  type OfficialPluginBudget,
  type PluginBudgetCategory,
};

export type BudgetRow = {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly limit: number;
  readonly unit: "bytes" | "ms";
  readonly gate: string;
  readonly group: string;
  readonly ok: boolean;
};

type BudgetsFile = {
  readonly measuredAt: string;
  readonly version: string;
  readonly budgets: ReadonlyArray<BudgetRow>;
};

const file = raw as BudgetsFile;

/** Full measured budget table (CI-enforced). */
export const BUDGETS: ReadonlyArray<BudgetRow> = file.budgets;

/** ISO timestamp of the last `bun run budgets` measurement. */
export const BUDGETS_MEASURED_AT = file.measuredAt;

/** Package version stamped into `budgets.json` when measured. */
export const BUDGETS_VERSION = file.version;

/**
 * Look up one budget row by id.
 *
 * @param id - Budget id from `budgets.json`
 */
export function budgetById(id: string): BudgetRow {
  const row = BUDGETS.find((b) => b.id === id);
  if (!row) throw new Error(`Unknown budget id: ${id}`);
  return row;
}

/**
 * Bytes → kilobytes, two-decimal display matching `BUDGETS.md`.
 *
 * @param bytes - Raw byte count
 */
export function bytesToKb(bytes: number): number {
  return Math.round((bytes / 1024) * 100) / 100;
}

/**
 * Format bytes for landing UI — one decimal when ≥ 10 kB, two below,
 * whole bytes under 1 kB.
 *
 * @param bytes - Raw byte count
 */
export function formatBytesLanding(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb >= 10) return `${kb.toFixed(1)} kB`;
  return `${kb.toFixed(2)} kB`;
}

/**
 * Format milliseconds for landing UI — whole ms at ≥ 1, otherwise `< 1 ms`.
 * Avoids false precision like `0.001 ms` / `35.563 ms`.
 *
 * @param ms - Duration in milliseconds
 */
export function formatMsLanding(ms: number): string {
  if (ms < 1) return "< 1 ms";
  return `${Math.round(ms)} ms`;
}

/**
 * Format a budget ceiling for landing UI (same rules as measured values).
 *
 * @param row - Measured budget row
 */
export function formatLimitLanding(row: BudgetRow): string {
  if (row.unit === "bytes") return formatBytesLanding(row.limit);
  return formatMsLanding(row.limit);
}

/**
 * Format a measured value for landing UI.
 *
 * @param row - Measured budget row
 */
export function formatValueLanding(row: BudgetRow): string {
  if (row.unit === "bytes") return formatBytesLanding(row.value);
  return formatMsLanding(row.value);
}

/**
 * Share of the budget used (0–100). Caps at 100 when over.
 *
 * @param row - Measured budget row
 */
export function budgetUsedPercent(row: BudgetRow): number {
  if (row.limit <= 0) return 0;
  return Math.min(100, Math.max(0, (row.value / row.limit) * 100));
}

/**
 * Format a budget value for mono labels (matches `BUDGETS.md` columns).
 *
 * @param row - Measured budget row
 */
export function formatBudgetValue(row: BudgetRow): string {
  if (row.unit === "bytes") {
    if (row.value < 1024) return `${row.value} B`;
    return `${bytesToKb(row.value).toFixed(2)} kB`;
  }
  if (row.value < 1) return `${row.value.toFixed(3)} ms`;
  return `${row.value.toFixed(3)} ms`;
}

/**
 * Format a budget ceiling the same way as the measured value.
 *
 * @param row - Measured budget row
 */
export function formatBudgetLimit(row: BudgetRow): string {
  if (row.unit === "bytes") {
    if (row.limit < 1024) return `${row.limit} B`;
    return `${bytesToKb(row.limit).toFixed(2)} kB`;
  }
  if (row.limit < 1) return `${row.limit.toFixed(3)} ms`;
  return `${row.limit.toFixed(3)} ms`;
}
