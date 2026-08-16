/**
 * Summary chips for the trace detail Sheet — counts from real effects[] + logs.
 *
 * SQL store work is elevated as "DB queries" (resource prefix `sql:`), matching
 * the compact scan language of professional trace sheets — without inventing an
 * EffectKind. Tier-1 cache lookups (`computed:…`) are "cache reads". Other
 * reads/writes still surface as EffectKind chips.
 */

import type { RunEffect, RunRow } from "@/client.ts";
import { formatDuration } from "./format-duration.ts";
import { effectKindSummaryLabel, type RunEffectKind } from "./effect-kind.ts";

/** Visual variant for a summary chip (drives icon + accent). */
export type EffectSummaryVariant =
  | "duration"
  | "api"
  | "gate"
  | "cache"
  | "db"
  | "logs"
  | RunEffectKind;

/** One chip in the Sheet summary row. */
export type EffectSummaryChip = {
  /** Stable key for React lists. */
  readonly key: string;
  /** Human label, e.g. `"2 DB queries"` or `"1 API call"`. */
  readonly label: string;
  /** Compact label for dense strips, e.g. `"2 DB"` or `"1 API"`. */
  readonly shortLabel: string;
  /** Icon / color variant for the summary strip. */
  readonly variant: EffectSummaryVariant;
  /** How the value was derived from the run (tooltip / a11y). */
  readonly detail: string;
};

/** Ordered EffectKind keys for stable chip order (after DB aggregation). */
const KIND_ORDER: readonly RunEffectKind[] = [
  "read",
  "write",
  "emit",
  "call",
  "ask",
  "send",
  "secret",
];

/**
 * True when an effect targets a SQL store resource (`sql:…`).
 *
 * @param resource - Effect resource ref
 */
export function isSqlResource(resource: string): boolean {
  return resource.startsWith("sql:");
}

/**
 * True when an effect is a tier-1 auto-cache lookup (`computed:…`).
 *
 * @param resource - Effect resource ref
 */
export function isComputedCacheKey(resource: string): boolean {
  return resource.startsWith("computed:");
}

/**
 * Build summary chips from a projected run.
 *
 * - Duration always first (via {@link formatDuration}).
 * - HTTP triggers add `"1 API call"` for the invocation itself (not an effect).
 * - Evaluated gates (`run.gates`) add `"N gate(s)"` with names in the detail.
 * - SQL store effects (`sql:…`) collapse into `"N DB queries"`.
 * - Remaining EffectKinds (non-SQL reads/writes, emits, …) get their own chips.
 * - Log line count from `logs.length`.
 *
 * @param run - Projected run row
 */
export function effectSummaryChips(
  run: Pick<RunRow, "trigger" | "durationMs" | "effects" | "logs" | "gates">,
): readonly EffectSummaryChip[] {
  const chips: EffectSummaryChip[] = [
    {
      key: "duration",
      label: formatDuration(run.durationMs),
      shortLabel: formatDuration(run.durationMs),
      variant: "duration",
      detail: `Handler duration from the run ledger (${formatDuration(run.durationMs)}).`,
    },
  ];

  if (run.trigger === "http") {
    chips.push({
      key: "api",
      label: "1 API call",
      shortLabel: "1 API",
      variant: "api",
      detail: "HTTP trigger invocation for this run (not counted as an effect).",
    });
  }

  const gateCount = run.gates.length;
  if (gateCount > 0) {
    chips.push({
      key: "gates",
      label: `${gateCount} ${gateCount === 1 ? "gate" : "gates"}`,
      shortLabel: `${gateCount} gate${gateCount === 1 ? "" : "s"}`,
      variant: "gate",
      detail: `Evaluated on this run: ${run.gates.join(", ")}.`,
    });
  }

  const cacheCount = run.effects.filter((e) => isComputedCacheKey(e.resource)).length;
  if (cacheCount > 0) {
    chips.push({
      key: "cache",
      label: `${cacheCount} cache ${cacheCount === 1 ? "read" : "reads"}`,
      shortLabel: `${cacheCount} cache`,
      variant: "cache",
      detail: `${cacheCount} effect${cacheCount === 1 ? "" : "s"} targeting computed:… cache keys.`,
    });
  }

  const dbCount = run.effects.filter((e) => isSqlResource(e.resource)).length;
  if (dbCount > 0) {
    chips.push({
      key: "db",
      label: `${dbCount} DB ${dbCount === 1 ? "query" : "queries"}`,
      shortLabel: `${dbCount} DB`,
      variant: "db",
      detail: `${dbCount} effect${dbCount === 1 ? "" : "s"} targeting sql:… store resources.`,
    });
  }

  const counts = countByKindExcludingSpecial(run.effects);
  for (const kind of KIND_ORDER) {
    const n = counts.get(kind) ?? 0;
    if (n === 0) continue;
    chips.push({
      key: kind,
      label: effectKindSummaryLabel(kind, n),
      shortLabel: effectKindSummaryLabel(kind, n),
      variant: kind,
      detail: `${n} non-SQL ${kind} effect${n === 1 ? "" : "s"} on the run ledger.`,
    });
  }

  const logCount = run.logs.length;
  if (logCount > 0) {
    chips.push({
      key: "logs",
      label: `${logCount} log ${logCount === 1 ? "line" : "lines"}`,
      shortLabel: `${logCount} log${logCount === 1 ? "" : "s"}`,
      variant: "logs",
      detail: `${logCount} ${logCount === 1 ? "entry" : "entries"} in run.logs.`,
    });
  }

  return chips;
}

/**
 * Event-detail label — SQL resources read as "DB query" / "DB write".
 *
 * @param effect - Ledger entry
 */
export function effectEventLabel(effect: Pick<RunEffect, "kind" | "resource">): string {
  if (isComputedCacheKey(effect.resource)) {
    return "Cache read";
  }
  if (isSqlResource(effect.resource)) {
    return effect.kind === "write" ? "DB write" : "DB query";
  }
  const labels: Record<RunEffectKind, string> = {
    read: "Read",
    write: "Write",
    emit: "Emit",
    send: "Send",
    ask: "Ask",
    secret: "Secret",
    call: "Call",
  };
  return labels[effect.kind];
}

function countByKindExcludingSpecial(effects: readonly RunEffect[]): Map<RunEffectKind, number> {
  const counts = new Map<RunEffectKind, number>();
  for (const e of effects) {
    if (isSqlResource(e.resource) || isComputedCacheKey(e.resource)) continue;
    counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  }
  return counts;
}
