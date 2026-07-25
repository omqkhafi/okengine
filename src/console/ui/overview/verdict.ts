/**
 * One-line plain-language Overview verdict (console §9.16).
 */

import type {
  CostBudget,
  OverviewFinding,
  OverviewVerdict,
  SloBurn,
} from "./types.ts";

/**
 * Build the top verdict from SLO burn, cost budgets, and ranked findings.
 *
 * @param options - Live burn + findings
 */
export function composeVerdict(options: {
  readonly hasDeclaredSlos: boolean;
  readonly slos: readonly SloBurn[];
  readonly costBudgets: readonly CostBudget[];
  readonly findings: readonly OverviewFinding[];
}): OverviewVerdict {
  const { hasDeclaredSlos, slos, costBudgets, findings } = options;

  const burning = slos
    .filter((s) => s.burnRate >= 1 && !s.ceremonial)
    .sort(
      (a, b) =>
        b.burnRate - a.burnRate ||
        (a.timeToExhaustionMs ?? Infinity) -
          (b.timeToExhaustionMs ?? Infinity),
    );

  if (burning.length > 0) {
    const top = burning[0]!;
    const tte = formatExhaustion(top.timeToExhaustionMs);
    const plural =
      burning.length === 1
        ? "one objective is burning fast"
        : `${burning.length} objectives are burning`;
    return {
      tone: top.burnRate >= 6 ? "critical" : "warn",
      line: `${plural} — ${top.name} will exhaust its budget ${tte}`,
    };
  }

  const costBurning = costBudgets
    .filter((c) => c.burnRate >= 1)
    .sort(
      (a, b) =>
        b.burnRate - a.burnRate ||
        (a.timeToExhaustionMs ?? Infinity) -
          (b.timeToExhaustionMs ?? Infinity),
    );
  if (costBurning.length > 0) {
    const top = costBurning[0]!;
    return {
      tone: "warn",
      line: `cost budget burning — ${top.name} will exhaust ${formatExhaustion(top.timeToExhaustionMs)}`,
    };
  }

  if (findings.length > 0) {
    const top = findings[0]!;
    return {
      tone: top.userHarm >= 90 ? "critical" : "warn",
      line: `${top.title.toLowerCase()}: ${top.detail}`,
    };
  }

  if (!hasDeclaredSlos) {
    return {
      tone: "empty",
      line: "no objectives declared yet — findings and golden signals below; declare a first SLO on your busiest flow",
    };
  }

  const ceremonial = slos.filter((s) => s.ceremonial);
  if (ceremonial.length === slos.length && slos.length > 0) {
    return {
      tone: "ok",
      line: `all ${slos.length} objective${slos.length === 1 ? "" : "s"} within budget — ${ceremonial.length} marked ceremonial (no burn in 90 days)`,
    };
  }

  return {
    tone: "ok",
    line: "all objectives within budget — no burning SLOs",
  };
}

/**
 * Format time-to-exhaustion for the verdict line.
 *
 * @param ms - Milliseconds, or null
 */
export function formatExhaustion(ms: number | null): string {
  if (ms == null) return "if the current burn continues";
  if (ms <= 0) return "now";
  const days = ms / 86_400_000;
  if (days >= 2) return `in ${Math.round(days)} days`;
  if (days >= 1) return "in 1 day";
  const hours = ms / 3_600_000;
  if (hours >= 2) return `in ${Math.round(hours)} hours`;
  if (hours >= 1) return "in 1 hour";
  const mins = Math.max(1, Math.round(ms / 60_000));
  return `in ${mins} minute${mins === 1 ? "" : "s"}`;
}

/**
 * Format a burn rate for display (e.g. `2.4×`).
 *
 * @param burnRate - Ratio
 */
export function formatBurnRate(burnRate: number): string {
  if (!Number.isFinite(burnRate)) return "∞×";
  if (burnRate >= 10) return `${burnRate.toFixed(0)}×`;
  if (burnRate >= 1) return `${burnRate.toFixed(1)}×`;
  return `${burnRate.toFixed(2)}×`;
}

/**
 * Format a duration for budget strips.
 *
 * @param ms - Milliseconds, or null
 */
export function formatBudgetDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms <= 0) return "exhausted";
  return formatExhaustion(ms).replace(/^in /, "");
}
