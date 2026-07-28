/**
 * Console Manifest Diff projection (console §9.12).
 *
 * Classification comes only from {@link diffManifest}. This module enriches
 * each change with real Runs traffic, a weekly bill, and the CI gate status.
 */

import { costOf, DEFAULT_MEDIUM_COSTS, type MediumCosts } from "../../elements/channel/costs.ts";
import { diffManifest, highestSeverity } from "../../manifest/diff.ts";
import type {
  Channel,
  DiffCategory,
  DiffKind,
  Flow,
  Manifest,
  ManifestChange,
} from "../../manifest/types.ts";
import { flowNameFromPath, isDeclaredBreak } from "../../manifest/undeclared.ts";
import type { WideEvent } from "../../runs/types.ts";

/** One week in milliseconds. */
export const WEEK_MS = 7 * 86_400_000;

/** CI gate status for a contract-breaking change. */
export type DiffCiGate = "blocked" | "acknowledged";

/** Enriched Manifest Diff line for the Console panel. */
export interface ConsoleDiffChange {
  readonly path: string;
  readonly category: DiffCategory;
  readonly kind: DiffKind;
  readonly summary: string;
  readonly before?: unknown;
  readonly after?: unknown;
  /** Owning flow when the path is under `/flows/{name}`. */
  readonly flowName: string | null;
  /** Real Runs count for that flow in the last week. */
  readonly runCountLastWeek: number;
  /**
   * Change × traffic copy, e.g. "this flow ran 41,208 times last week,
   * it sent nothing, and it will now email every caller."
   */
  readonly blastLine: string | null;
  /** Weekly bill delta in USD (rate × recent volume), not per-call. */
  readonly weeklyDeltaUsd: number | null;
  /** Formatted weekly bill, e.g. "+$212 per week". */
  readonly weeklyBillLine: string | null;
  /**
   * CI gate: undeclared contract breaks are `blocked`;
   * `breaking: true` acknowledgements are `acknowledged`.
   * Null for non-contract-breaking categories.
   */
  readonly ciGate: DiffCiGate | null;
}

/** Full Manifest Diff panel projection. */
export interface ConsoleDiffProjection {
  /** Whether a baseline Manifest is available to compare. */
  readonly hasBaseline: boolean;
  /** Highest blast-radius category, or null when empty / no baseline. */
  readonly severity: DiffCategory | null;
  /** Count of undeclared (blocked) contract breaks. */
  readonly blockedCount: number;
  /** Count of `breaking: true` acknowledged contract breaks. */
  readonly acknowledgedCount: number;
  /** Changes sorted by blast radius, then path. */
  readonly changes: readonly ConsoleDiffChange[];
}

/** Options for {@link projectManifestDiff}. */
export interface ProjectManifestDiffOptions {
  readonly before: Manifest | null;
  readonly after: Manifest | null;
  readonly runs?: readonly WideEvent[];
  readonly now?: number;
  readonly costs?: MediumCosts;
}

/**
 * Project Manifest Diff for the Console — classify via {@link diffManifest},
 * then multiply by real Runs traffic and weekly cost.
 *
 * @param options - Baseline, candidate, Runs, clock
 */
export function projectManifestDiff(options: ProjectManifestDiffOptions): ConsoleDiffProjection {
  const before = options.before;
  const after = options.after;
  if (!before || !after) {
    return {
      hasBaseline: false,
      severity: null,
      blockedCount: 0,
      acknowledgedCount: 0,
      changes: [],
    };
  }

  const now = options.now ?? Date.now();
  const costs = options.costs ?? DEFAULT_MEDIUM_COSTS;
  const runs = options.runs ?? [];
  const runCounts = countRunsByFlowLastWeek(runs, now);

  const { changes: raw } = diffManifest(before, after);
  const channels = after.channels ?? before.channels;

  const changes = [...raw]
    .map((c) =>
      enrichChange(c, {
        before,
        after,
        runCounts,
        channels,
        costs,
      }),
    )
    .sort(compareDiffChanges);

  let blockedCount = 0;
  let acknowledgedCount = 0;
  for (const c of changes) {
    if (c.ciGate === "blocked") blockedCount += 1;
    if (c.ciGate === "acknowledged") acknowledgedCount += 1;
  }

  return {
    hasBaseline: true,
    severity: highestSeverity(changes),
    blockedCount,
    acknowledgedCount,
    changes,
  };
}

/**
 * Count real Runs per flow over the trailing week window.
 *
 * @param runs - Wide events from the Runs store
 * @param now - Clock (epoch ms)
 */
export function countRunsByFlowLastWeek(
  runs: readonly WideEvent[],
  now: number,
): ReadonlyMap<string, number> {
  const start = now - WEEK_MS;
  const counts = new Map<string, number>();
  for (const r of runs) {
    if (r.startedAt < start || r.startedAt > now) continue;
    counts.set(r.flow, (counts.get(r.flow) ?? 0) + 1);
  }
  return counts;
}

/**
 * Format an integer with thousands separators (en-US).
 *
 * @param n - Count
 */
export function formatRunCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Format a weekly bill delta — unit is the week, never per-call.
 *
 * @param weeklyDeltaUsd - Signed USD for the week
 */
export function formatWeeklyBill(weeklyDeltaUsd: number): string {
  const abs = Math.abs(weeklyDeltaUsd);
  const digits = abs >= 1 ? 0 : 2;
  const body = `$${abs.toFixed(digits)}`;
  if (weeklyDeltaUsd > 0) return `+${body} per week`;
  if (weeklyDeltaUsd < 0) return `-${body} per week`;
  return `${body} per week`;
}

/**
 * Build the change × traffic line when send effects (or similar) widen.
 *
 * @param options - Flow pair, run count, channels
 */
export function formatBlastLine(options: {
  readonly flowName: string;
  readonly runCount: number;
  readonly beforeFlow: Flow | undefined;
  readonly afterFlow: Flow | undefined;
  readonly channels: Record<string, Channel> | undefined;
}): string | null {
  const { runCount, beforeFlow, afterFlow, channels } = options;
  const beforeSends = beforeFlow?.effects?.sends ?? [];
  const afterSends = afterFlow?.effects?.sends ?? [];
  const added = afterSends.filter((t) => !beforeSends.includes(t));
  if (added.length === 0) return null;

  const past =
    beforeSends.length === 0 ? "sent nothing" : `sent via ${describeMedia(beforeSends, channels)}`;
  const future = `will now ${verbForMedia(describeMedia(added, channels))} every caller`;
  return `this flow ran ${formatRunCount(runCount)} times last week, it ${past}, and it ${future}`;
}

/**
 * Weekly bill from estimatePerCall and/or newly declared send media.
 *
 * @param options - Flow pair, volume, costs
 */
export function weeklyCostDeltaUsd(options: {
  readonly beforeFlow: Flow | undefined;
  readonly afterFlow: Flow | undefined;
  readonly runCount: number;
  readonly channels: Record<string, Channel> | undefined;
  readonly costs: MediumCosts;
}): number | null {
  const { beforeFlow, afterFlow, runCount, channels, costs } = options;
  const beforeEst = beforeFlow?.cost?.estimatePerCall ?? 0;
  const afterEst = afterFlow?.cost?.estimatePerCall ?? 0;
  let perCall = afterEst - beforeEst;

  const beforeSends = new Set(beforeFlow?.effects?.sends ?? []);
  const afterSends = afterFlow?.effects?.sends ?? [];
  for (const t of afterSends) {
    if (!beforeSends.has(t)) {
      perCall += costOf(mediumOf(t, channels), costs);
    }
  }
  for (const t of beforeSends) {
    if (!afterSends.includes(t)) {
      perCall -= costOf(mediumOf(t, channels), costs);
    }
  }

  if (perCall === 0) return null;
  return perCall * runCount;
}

function enrichChange(
  change: ManifestChange,
  ctx: {
    readonly before: Manifest;
    readonly after: Manifest;
    readonly runCounts: ReadonlyMap<string, number>;
    readonly channels: Record<string, Channel> | undefined;
    readonly costs: MediumCosts;
  },
): ConsoleDiffChange {
  const flowName = flowNameFromPath(change.path);
  const runCountLastWeek = flowName !== null ? (ctx.runCounts.get(flowName) ?? 0) : 0;
  const beforeFlow = flowName !== null ? ctx.before.flows?.[flowName] : undefined;
  const afterFlow = flowName !== null ? ctx.after.flows?.[flowName] : undefined;

  let ciGate: DiffCiGate | null = null;
  if (change.category === "contract-breaking") {
    ciGate = isDeclaredBreak(change, ctx.before, ctx.after) ? "acknowledged" : "blocked";
  }

  // Traffic × cost copy belongs on effect / send / cost paths — not every
  // row for the same flow (e.g. a gate change must not inherit a send bill).
  const effectScoped =
    flowName !== null &&
    (change.category === "effect-widening" ||
      change.path.includes("/effects") ||
      change.path.includes("/sends") ||
      change.path.includes("/cost"));

  const blastLine = effectScoped
    ? formatBlastLine({
        flowName,
        runCount: runCountLastWeek,
        beforeFlow,
        afterFlow,
        channels: ctx.channels,
      })
    : null;

  const weeklyDeltaUsd = effectScoped
    ? weeklyCostDeltaUsd({
        beforeFlow,
        afterFlow,
        runCount: runCountLastWeek,
        channels: ctx.channels,
        costs: ctx.costs,
      })
    : null;

  return {
    path: change.path,
    category: change.category,
    kind: change.kind,
    summary: change.summary,
    ...(change.before !== undefined ? { before: change.before } : {}),
    ...(change.after !== undefined ? { after: change.after } : {}),
    flowName,
    runCountLastWeek,
    blastLine,
    weeklyDeltaUsd,
    weeklyBillLine: weeklyDeltaUsd !== null ? formatWeeklyBill(weeklyDeltaUsd) : null,
    ciGate,
  };
}

function compareDiffChanges(a: ConsoleDiffChange, b: ConsoleDiffChange): number {
  const rank: Record<DiffCategory, number> = {
    "contract-breaking": 3,
    "permission-widening": 2,
    "effect-widening": 1,
    "no-impact": 0,
  };
  const byCat = rank[b.category] - rank[a.category];
  if (byCat !== 0) return byCat;
  return a.path.localeCompare(b.path);
}

function mediumOf(template: string, channels: Record<string, Channel> | undefined): string {
  return channels?.[template]?.medium ?? "email";
}

function describeMedia(
  templates: readonly string[],
  channels: Record<string, Channel> | undefined,
): string {
  const media = [...new Set(templates.map((t) => mediumOf(t, channels)))];
  if (media.length === 0) return "nothing";
  if (media.length === 1) return media[0]!;
  return media.join("/");
}

function verbForMedia(media: string): string {
  if (media === "email") return "email";
  if (media === "sms") return "sms";
  if (media === "whatsapp") return "whatsapp";
  if (media === "push") return "push";
  return `send ${media} to`;
}
