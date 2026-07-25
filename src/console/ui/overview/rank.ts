/**
 * Ranked union of every other panel's findings (console §9.16).
 *
 * Order: user harm → irreversibility → trend. Detection stays in each
 * panel — this module only maps and sorts.
 */

import { findCycles } from "../architecture/pathologies.ts";
import type { CausalityGraph } from "../flows/graph.ts";
import { unguardedFlowFindings } from "../gates/findings.ts";
import type { GateAuditRecord } from "../gates/types.ts";
import { spamComplaintFindings } from "../channels/findings.ts";
import type { OutcomeRow } from "../channels/types.ts";
import { overdueCronFindings } from "../clock/findings.ts";
import type { ClockCronRecord } from "../clock/types.ts";
import { deadLetterFindings } from "../signals/findings.ts";
import type { SignalRecord } from "../signals/types.ts";
import { dormantSecrets } from "../vault/dormant.ts";
import type { VaultRecord } from "../vault/types.ts";
import { overBudgetFindings } from "../ai/findings.ts";
import type { PromptVersionMetrics } from "../ai/types.ts";
import { pluginCapabilityFindings } from "../plugins/findings.ts";
import type { DiffChangeRecord } from "../diff/types.ts";
import type { OverviewFinding } from "./types.ts";

/** Inputs collected from each panel's real finding source. */
export interface FindingInputs {
  readonly gatesAudit: GateAuditRecord;
  readonly signals: readonly SignalRecord[];
  readonly crons: readonly ClockCronRecord[];
  readonly vaultSecrets: readonly VaultRecord[];
  readonly channelOutcomes: readonly OutcomeRow[];
  readonly architectureGraph: CausalityGraph | null;
  readonly diffChanges: readonly DiffChangeRecord[];
  readonly aiVersions: readonly PromptVersionMetrics[];
  readonly now: number;
}

/**
 * Collect and rank findings from every panel source.
 *
 * @param inputs - Panel projections / graphs
 */
export function rankedFindings(inputs: FindingInputs): readonly OverviewFinding[] {
  const findings: OverviewFinding[] = [
    ...mapUnguarded(inputs.gatesAudit),
    ...mapDeadLetters(inputs.signals),
    ...mapOverdue(inputs.crons),
    ...mapDormant(inputs.vaultSecrets, inputs.now),
    ...mapSpam(inputs.channelOutcomes),
    ...mapCycles(inputs.architectureGraph),
    ...mapPlugins(inputs.diffChanges),
    ...mapAiBudget(inputs.aiVersions),
  ];

  return findings.sort(compareFindings);
}

/**
 * Compare findings: user harm, then irreversibility, then trend.
 *
 * @param a - Left
 * @param b - Right
 */
export function compareFindings(a: OverviewFinding, b: OverviewFinding): number {
  if (b.userHarm !== a.userHarm) return b.userHarm - a.userHarm;
  if (b.irreversibility !== a.irreversibility) {
    return b.irreversibility - a.irreversibility;
  }
  if (b.trend !== a.trend) return b.trend - a.trend;
  return a.id.localeCompare(b.id);
}

function mapUnguarded(audit: GateAuditRecord): OverviewFinding[] {
  return unguardedFlowFindings(audit).map((line) => ({
    id: `gates:unguarded`,
    source: "gates" as const,
    title: "Unguarded flows",
    detail: line.message,
    href: "/gates",
    userHarm: 90,
    irreversibility: 80,
    trend: line.count,
  }));
}

function mapDeadLetters(signals: readonly SignalRecord[]): OverviewFinding[] {
  return deadLetterFindings(signals).map((f) => ({
    id: `signals:dlq:${f.signal}`,
    source: "signals" as const,
    title: "Dead letters",
    detail: `${f.signal}: ${f.dead} dead letter${f.dead === 1 ? "" : "s"} (${f.delivery})`,
    href: `/signals?signal=${encodeURIComponent(f.signal)}`,
    userHarm: 70,
    irreversibility: 40,
    trend: f.dead,
  }));
}

function mapOverdue(crons: readonly ClockCronRecord[]): OverviewFinding[] {
  return overdueCronFindings(crons).map((f) => ({
    id: `clock:overdue:${f.name}`,
    source: "clock" as const,
    title: "Overdue cron",
    detail: `${f.name} is overdue${f.missedRuns > 0 ? ` · ${f.missedRuns} missed` : ""}`,
    href: `/clock?cron=${encodeURIComponent(f.name)}`,
    userHarm: 60,
    irreversibility: 30,
    trend: f.missedRuns,
  }));
}

function mapDormant(
  secrets: readonly VaultRecord[],
  now: number,
): OverviewFinding[] {
  const dormant = dormantSecrets(secrets, now);
  if (dormant.length === 0) return [];
  return [
    {
      id: "vault:dormant",
      source: "vault",
      title: "Dormant secrets",
      detail: `${dormant.length} secret${dormant.length === 1 ? "" : "s"} unread for 90+ days (or never): ${dormant.map((s) => s.name).join(", ")}`,
      href: "/vault",
      userHarm: 50,
      irreversibility: 70,
      trend: dormant.length,
    },
  ];
}

function mapSpam(outcomes: readonly OutcomeRow[]): OverviewFinding[] {
  return spamComplaintFindings(outcomes).map((f) => ({
    id: "channels:spam",
    source: "channels" as const,
    title: "Spam complaints",
    detail: `${f.count} delivered-then-complained — burns sender reputation`,
    href: "/channels",
    userHarm: 100,
    irreversibility: 95,
    trend: f.count,
  }));
}

function mapCycles(graph: CausalityGraph | null): OverviewFinding[] {
  if (!graph) return [];
  return findCycles(graph).map((f) => ({
    id: `architecture:cycle:${f.nodeIds.join(">")}`,
    source: "architecture" as const,
    title: f.title,
    detail: f.detail,
    href: "/architecture",
    userHarm: 65,
    irreversibility: 55,
    trend: f.severity === "critical" ? 2 : 1,
  }));
}

function mapPlugins(changes: readonly DiffChangeRecord[]): OverviewFinding[] {
  return pluginCapabilityFindings(changes).map((f) => ({
    id: `plugins:widen:${f.path}`,
    source: "plugins" as const,
    title: "Plugin capability widening",
    detail: f.summary,
    href: `/diff?path=${encodeURIComponent(f.path)}`,
    userHarm: 55,
    irreversibility: 90,
    trend: 1,
  }));
}

function mapAiBudget(
  versions: readonly PromptVersionMetrics[],
): OverviewFinding[] {
  return overBudgetFindings(versions).map((f) => ({
    id: `ai:budget:${f.prompt}@${f.version}`,
    source: "ai" as const,
    title: "Model budget overrun",
    detail: `${f.prompt}@${f.version}: ${(f.overBudgetRate * 100).toFixed(1)}% over budget (p95 $${f.p95Cost.toFixed(3)})`,
    href: `/ai?prompt=${encodeURIComponent(f.prompt)}&version=${f.version}`,
    userHarm: 45,
    irreversibility: 50,
    trend: Math.round(f.overBudgetRate * 100),
  }));
}
