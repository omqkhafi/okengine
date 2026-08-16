/**
 * Project the Monitoring health strip from real list + buffer sources.
 *
 * Missing observations render `tone: "empty"` — never a fake zero.
 */

import type { ClockListCron, SignalsListRow, StoreListStore } from "@/client.ts";
import type { LiveStatus } from "@/features/flows/data/use-console-live.ts";
import { latestReplicaLagFromRuns } from "@/features/store/lib/replica-lag.ts";
import type { VaultBackendCard } from "@/features/vault/lib/backend.ts";
import type { RunRow } from "@/client.ts";
import { formatDuration } from "@/features/flows/traces/format-duration.ts";
import type { WindowStats } from "./window-stats.ts";

/** Strip cell tone. */
export type HealthCellTone = "ok" | "warn" | "empty";

/** One chip in the health strip. */
export type HealthCell = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tone: HealthCellTone;
  readonly href?: "/store" | "/vault";
};

/** Inputs for {@link healthCells}. */
export interface HealthCellsInput {
  readonly vaultCard: VaultBackendCard | null;
  readonly stores: readonly StoreListStore[];
  readonly runs: readonly RunRow[];
  readonly crons: readonly ClockListCron[];
  readonly signals: readonly SignalsListRow[];
  readonly window: WindowStats;
  readonly liveStatus: LiveStatus;
}

/**
 * Newest-run replica lag across every store child (matches Store live badge).
 *
 * @param runs - Runs buffer
 * @param stores - Store list
 */
export function latestReplicaLagAcrossStores(
  runs: readonly RunRow[],
  stores: readonly StoreListStore[],
): number | null {
  const refs = new Set(stores.flatMap((store) => store.children.map((child) => child.effectRef)));
  if (refs.size === 0) return null;
  return latestReplicaLagFromRuns(runs, refs);
}

/**
 * Build strip cells. Order is Vault → Store drift → lag → Clock → Signal → window → live.
 *
 * @param input - Already-fetched projections
 */
export function healthCells(input: HealthCellsInput): readonly HealthCell[] {
  return [
    vaultCell(input.vaultCard),
    driftCell(input.stores),
    lagCell(input.runs, input.stores),
    clockCell(input.crons),
    signalCell(input.signals),
    windowCell(input.window),
    liveCell(input.liveStatus),
  ];
}

function vaultCell(card: VaultBackendCard | null): HealthCell {
  if (!card) {
    return { id: "vault", label: "Vault", value: "no backend", tone: "empty", href: "/vault" };
  }
  const warn = card.badges.find((b) => b.tone === "warn");
  if (warn) {
    return { id: "vault", label: "Vault", value: warn.label, tone: "warn", href: "/vault" };
  }
  const seal = card.badges.find((b) => b.id === "unsealed" || b.id === "sealed");
  const kek = card.facts.find((f) => f.label === "KEK generation");
  const parts = [seal?.label, kek?.value].filter((part): part is string => Boolean(part));
  return {
    id: "vault",
    label: "Vault",
    value: parts.length > 0 ? parts.join(" · ") : card.title,
    tone: "ok",
    href: "/vault",
  };
}

function driftCell(stores: readonly StoreListStore[]): HealthCell {
  if (stores.length === 0) {
    return { id: "drift", label: "Store", value: "no stores", tone: "empty", href: "/store" };
  }
  const drifted = stores.filter((s) => s.migrationDrift?.drifted === true).length;
  if (drifted > 0) {
    return {
      id: "drift",
      label: "Store",
      value: `${drifted} drifted`,
      tone: "warn",
      href: "/store",
    };
  }
  return { id: "drift", label: "Store", value: "in sync", tone: "ok", href: "/store" };
}

function lagCell(runs: readonly RunRow[], stores: readonly StoreListStore[]): HealthCell {
  const lagMs = latestReplicaLagAcrossStores(runs, stores);
  if (lagMs == null) {
    return { id: "lag", label: "Replica", value: "no lag observed", tone: "empty", href: "/store" };
  }
  return {
    id: "lag",
    label: "Replica",
    value: formatDuration(lagMs),
    tone: lagMs >= 250 ? "warn" : "ok",
    href: "/store",
  };
}

function clockCell(crons: readonly ClockListCron[]): HealthCell {
  if (crons.length === 0) {
    return { id: "clock", label: "Clock", value: "no crons", tone: "empty" };
  }
  const overdue = crons.filter((c) => c.health.overdue).length;
  if (overdue > 0) {
    return { id: "clock", label: "Clock", value: `${overdue} overdue`, tone: "warn" };
  }
  const leader = crons.find((c) => c.health.leaderInstanceId)?.health.leaderInstanceId;
  return {
    id: "clock",
    label: "Clock",
    value: leader ? `lease ${shortId(leader)}` : "on schedule",
    tone: "ok",
  };
}

function signalCell(signals: readonly SignalsListRow[]): HealthCell {
  if (signals.length === 0) {
    return { id: "signal", label: "Signal", value: "no signals", tone: "empty" };
  }
  const dead = signals.reduce((n, s) => n + s.dead, 0);
  const pending = signals.reduce((n, s) => n + s.pending, 0);
  const lag = signals.reduce<number | null>((best, s) => {
    if (s.outboxLagMs == null) return best;
    return best == null || s.outboxLagMs > best ? s.outboxLagMs : best;
  }, null);
  if (dead > 0) {
    return { id: "signal", label: "Signal", value: `${dead} dead`, tone: "warn" };
  }
  if (lag != null && lag >= 250) {
    return { id: "signal", label: "Signal", value: `${formatDuration(lag)} lag`, tone: "warn" };
  }
  if (pending > 0) {
    return { id: "signal", label: "Signal", value: `${pending} pending`, tone: "ok" };
  }
  return { id: "signal", label: "Signal", value: "quiet", tone: "ok" };
}

function windowCell(window: WindowStats): HealthCell {
  if (window.kind === "empty") {
    return { id: "window", label: "Runs", value: "no recent runs", tone: "empty" };
  }
  const pct = Math.round(window.errorRate * 100);
  return {
    id: "window",
    label: "Runs",
    value: `P95 ${formatDuration(window.p95Ms)} · ${pct}% err`,
    tone: window.errorRate > 0 || window.p95Ms >= 250 ? "warn" : "ok",
  };
}

function liveCell(status: LiveStatus): HealthCell {
  if (status === "open") {
    return { id: "live", label: "Live", value: "live", tone: "ok" };
  }
  if (status === "connecting") {
    return { id: "live", label: "Live", value: "connecting", tone: "empty" };
  }
  return { id: "live", label: "Live", value: "polling", tone: "warn" };
}

function shortId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}
