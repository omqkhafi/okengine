/**
 * Compose the Overview view from every panel's outputs (console §9.16).
 *
 * Pure aggregator — no finding detection lives here.
 */

import type { Manifest } from "../../../manifest/types.ts";
import type { AiListResponse } from "../ai/types.ts";
import { buildCausalityGraph } from "../flows/graph.ts";
import type { CausalityGraph } from "../flows/graph.ts";
import type { DiffListResponse } from "../diff/types.ts";
import { whatChangedSummary } from "../diff/summary.ts";
import type { GatesListResponse } from "../gates/types.ts";
import type { ClockListResponse } from "../clock/types.ts";
import type { SignalRecord } from "../signals/types.ts";
import type { VaultListResponse } from "../vault/types.ts";
import type { ChannelsListResponse } from "../channels/types.ts";
import type { RunRecord } from "../runs/types.ts";
import { firstSloInvite } from "./busiest.ts";
import { computeCostBudgets } from "./cost.ts";
import { computeGoldenSignals } from "./golden.ts";
import { rankedFindings } from "./rank.ts";
import { computeSloBurns, hasDeclaredSlos } from "./slo.ts";
import type { OverviewView } from "./types.ts";
import { composeVerdict } from "./verdict.ts";

/** Panel snapshots Overview aggregates. */
export interface OverviewInputs {
  readonly manifest: Manifest | null;
  readonly runs: readonly RunRecord[];
  readonly gates: GatesListResponse | null;
  readonly signals: readonly SignalRecord[];
  readonly clock: ClockListResponse | null;
  readonly vault: VaultListResponse | null;
  readonly channels: ChannelsListResponse | null;
  readonly ai: AiListResponse | null;
  readonly diff: DiffListResponse | null;
  readonly now: number;
  /** Optional prebuilt graph (tests); otherwise built from Manifest. */
  readonly architectureGraph?: CausalityGraph | null;
}

/**
 * Compose Overview from real panel projections.
 *
 * @param inputs - Aggregated panel data
 */
export function composeOverview(inputs: OverviewInputs): OverviewView {
  const {
    manifest,
    runs,
    gates,
    signals,
    clock,
    vault,
    channels,
    ai,
    diff,
    now,
  } = inputs;

  const graph =
    inputs.architectureGraph !== undefined
      ? inputs.architectureGraph
      : manifest
        ? buildCausalityGraph(manifest)
        : null;

  const declared = hasDeclaredSlos(manifest);
  const slos = computeSloBurns({ manifest, runs, now });
  const costBudgets = computeCostBudgets({ manifest, ai, runs, now });
  const findings = rankedFindings({
    gatesAudit: gates?.audit ?? {
      unguardedFlows: [],
      orphanPermissions: [],
      emptyRoles: [],
      unattachedGates: [],
    },
    signals,
    crons: clock?.crons ?? [],
    vaultSecrets: vault?.secrets ?? [],
    channelOutcomes: channels?.outcomes ?? [],
    architectureGraph: graph,
    diffChanges: diff?.changes ?? [],
    aiVersions: ai?.versions ?? [],
    now,
  });
  const whatChanged = diff
    ? (() => {
        const s = whatChangedSummary(diff);
        return {
          hasBaseline: s.hasBaseline,
          severity: s.severity,
          changeCount: s.changeCount,
          line: s.line,
          href: s.href,
        };
      })()
    : {
        hasBaseline: false,
        severity: null,
        changeCount: 0,
        line: "Manifest Diff unavailable",
        href: "/diff",
      };
  const golden = computeGoldenSignals(runs, now);
  const invite = declared ? null : firstSloInvite(runs);
  const verdict = composeVerdict({
    hasDeclaredSlos: declared,
    slos,
    costBudgets,
    findings,
  });

  return {
    verdict,
    slos,
    costBudgets,
    whatChanged,
    findings,
    golden,
    firstSloInvite: invite,
    hasDeclaredSlos: declared,
  };
}
