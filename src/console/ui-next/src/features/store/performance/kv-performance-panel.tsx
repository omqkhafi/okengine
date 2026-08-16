/**
 * Store KV engine telemetry — INFO KPIs, commandstats, SLOWLOG (no hot-keys).
 */

import { useMemo, useState, type JSX, type ReactNode } from "react";
import { Activity03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  STORE_KV_STATS_SERVER_WIDE_GAP,
  STORE_KV_STATS_SLOWLOG_ARGS_GAP,
  type StoreKvCommandStatRow,
  type StoreKvSlowlogRow,
  type StoreListStore,
} from "@/client.ts";
import { DetailHeader } from "@/components/explorer/detail-header.tsx";
import { ExplorerEmpty } from "@/components/explorer/explorer-empty.tsx";
import { EXPLORER_STRIP_CLASS } from "@/components/explorer/explorer-chrome.ts";
import { CallPiiButton } from "@/features/units/call/call-pii-button.tsx";
import { QueryResults } from "../query/query-results.tsx";
import { pickQueryStore } from "../lib/query-defaults.ts";
import { useStoreKvStats } from "../data/use-store-kv-stats.ts";

/** Props for {@link KvPerformancePanel}. */
export interface KvPerformancePanelProps {
  readonly stores: readonly StoreListStore[];
  readonly selectedEffectRef: string | null;
  readonly tenant: string | null;
  /** Start-panel collapse control. */
  readonly leading?: ReactNode;
}

/**
 * Right-pane engine telemetry for the KV facet.
 *
 * @param props - Stores + selection
 */
export function KvPerformancePanel({
  stores,
  selectedEffectRef,
  tenant,
  leading,
}: KvPerformancePanelProps): JSX.Element {
  const store = pickQueryStore(stores, "kv", selectedEffectRef);
  const [reveal, setReveal] = useState(false);
  const statsInput = store
    ? { ref: store.ref, ...(tenant ? { tenant } : {}), ...(reveal ? { revealPii: true } : {}) }
    : null;
  const stats = useStoreKvStats(statsInput);

  const statsError = errorMessage(stats.error);
  const statsCode = errorCode(stats.error);
  const commandRows = useMemo(
    () => (stats.data?.commands ?? []).map(commandDisplayRow),
    [stats.data?.commands],
  );
  const slowRows = useMemo(
    () => (stats.data?.slowlog ?? []).map(slowlogDisplayRow),
    [stats.data?.slowlog],
  );

  if (!store) {
    return (
      <ExplorerEmpty
        icon={Activity03Icon}
        title="No KV store"
        description="KV performance reads INFO / COMMANDSTATS / SLOWLOG on a redis-backed namespace."
        leading={leading}
      />
    );
  }

  if (statsCode === "KvStatsUnsupported") {
    return (
      <ExplorerEmpty
        leading={leading}
        icon={Activity03Icon}
        title="Engine telemetry unavailable"
        description={
          statsError ??
          "KV stats are not available on this driver (in-process memory has no INFO / SLOWLOG)."
        }
      />
    );
  }

  const kpis = stats.data?.kpis;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-slot="store-kv-performance">
      <DetailHeader
        dataSlot="store-kv-performance-header"
        leading={leading}
        icon={<HugeiconsIcon icon={Activity03Icon} className="size-4" />}
        title="KV performance"
        badge={
          <span className="font-mono text-[10px] font-medium tracking-[0.08em] text-muted-foreground">
            {store.ref}
          </span>
        }
        subtitle={
          <span className="font-mono text-[11px] leading-none text-muted-foreground">
            {stats.data?.engine ?? "—"}
          </span>
        }
        actions={
          <CallPiiButton
            piiMasked={!reveal}
            disabled={stats.isPending}
            onToggle={() => setReveal((v) => !v)}
          />
        }
      />
      <p
        className="shrink-0 border-b border-border/60 bg-amber-500/8 px-3 py-1.5 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200"
        data-slot="store-kv-stats-gap"
        role="note"
      >
        INFO / COMMANDSTATS / LATENCY are instance-wide, not scoped to{" "}
        <span className="font-mono">{stats.data?.namespacePrefix ?? "oke:kv:{ns}:"}</span>.
        Limitation: {STORE_KV_STATS_SERVER_WIDE_GAP}. SLOWLOG args are keys and values — collapsed
        until reveal. Limitation: {STORE_KV_STATS_SLOWLOG_ARGS_GAP}. No hot-key table (OSS Redis
        does not expose one without MONITOR).
      </p>
      <div className={EXPLORER_STRIP_CLASS}>
        <KpiChip
          label="Hit rate"
          value={formatPct(kpis?.hitRate ?? null)}
          title="keyspace_hits / (hits + misses)"
        />
        <KpiChip
          label="Ops / sec"
          value={kpis?.opsPerSec != null ? String(kpis.opsPerSec) : "—"}
          title="instantaneous_ops_per_sec"
        />
        <KpiChip
          label="Evicted"
          value={kpis?.evictedKeys != null ? String(kpis.evictedKeys) : "—"}
          title="evicted_keys"
        />
        <KpiChip
          label="Expired"
          value={kpis?.expiredKeys != null ? String(kpis.expiredKeys) : "—"}
          title="expired_keys"
        />
      </div>
      <div className="min-h-0 flex-1">
        <QueryResults
          rows={commandRows}
          error={statsError}
          pending={stats.isPending}
          meta={stats.data ? `${stats.data.commands.length} commands` : null}
          storeRef={store.ref}
        />
      </div>
      <div className="min-h-0 flex-1 border-t border-border/60">
        <QueryResults
          rows={slowRows}
          error={null}
          pending={stats.isPending && !stats.data}
          meta={
            stats.data
              ? `${stats.data.slowlog.length} slowlog · ${stats.data.masked ? "args collapsed" : "args revealed"}`
              : "slowlog"
          }
          storeRef={store.ref}
        />
      </div>
    </div>
  );
}

function KpiChip({
  label,
  value,
  title,
}: {
  readonly label: string;
  readonly value: string;
  readonly title: string;
}): JSX.Element {
  return (
    <span
      className="inline-flex h-full items-center gap-1.5 border-r border-border/60 px-2 text-[11px]"
      title={title}
    >
      <span className="font-mono tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function commandDisplayRow(row: StoreKvCommandStatRow): Record<string, unknown> {
  return {
    command: row.command,
    calls: row.calls,
    usec: row.usec,
    usec_per_call: row.usecPerCall,
  };
}

function slowlogDisplayRow(row: StoreKvSlowlogRow): Record<string, unknown> {
  return {
    command: row.command,
    duration_us: row.durationUs,
    args: row.args.join(" "),
    id: row.id,
  };
}

function formatPct(value: number | null): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}
