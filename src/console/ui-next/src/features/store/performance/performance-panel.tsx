/**
 * Store SQL query performance — pg_stat_statements, lock blocking, Index Advisor.
 */

import { useMemo, useState, type JSX } from "react";
import { Activity03Icon } from "@hugeicons/core-free-icons";
import {
  STORE_SQL_STATS_PII_GAP,
  type StoreListStore,
  type StoreSqlAdviseResult,
  type StoreSqlStatementRow,
} from "@/client.ts";
import { ExplorerEmpty } from "@/components/explorer/explorer-empty.tsx";
import { EXPLORER_STRIP_CLASS, SECTION_HEAD_CLASS } from "@/components/explorer/explorer-chrome.ts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils.ts";
import { CallPiiButton } from "@/features/units/call/call-pii-button.tsx";
import { QueryResults } from "../query/query-results.tsx";
import { pickQueryStore } from "../lib/query-defaults.ts";
import { useStoreSql } from "../data/use-store-sql.ts";
import { useStoreSqlAdvise } from "../data/use-store-sql-advise.ts";
import { useStoreSqlLocks } from "../data/use-store-sql-locks.ts";
import { useStoreSqlStats } from "../data/use-store-sql-stats.ts";
import { indexAdvisorEnableMode } from "./advisor-enable.ts";
import { PG_LIBRARY_EXTENSIONS, extensionInstallSql } from "../lib/pg-extension-library.ts";
import { KvPerformancePanel } from "./kv-performance-panel.tsx";

/** Props for {@link PerformancePanel}. */
export interface PerformancePanelProps {
  readonly stores: readonly StoreListStore[];
  readonly selectedEffectRef: string | null;
  readonly tenant: string | null;
  /** Which facet opened the performance pane (`kv` vs SQL default). */
  readonly facet?: "sql" | "kv";
}

/**
 * Right-pane engine telemetry for the SQL or KV facet.
 *
 * @param props - Stores + selection
 */
export function PerformancePanel({
  stores,
  selectedEffectRef,
  tenant,
  facet = "sql",
}: PerformancePanelProps): JSX.Element {
  if (facet === "kv") {
    return (
      <KvPerformancePanel stores={stores} selectedEffectRef={selectedEffectRef} tenant={tenant} />
    );
  }
  const store = pickQueryStore(stores, "sql", selectedEffectRef);
  const [lockReveal, setLockReveal] = useState(false);
  const [adviseFor, setAdviseFor] = useState<StoreSqlStatementRow | null>(null);
  const statsInput = store ? { ref: store.ref, ...(tenant ? { tenant } : {}) } : null;
  const stats = useStoreSqlStats(statsInput);
  const locks = useStoreSqlLocks(
    store ? { ...statsInput!, ...(lockReveal ? { revealPii: true } : {}) } : null,
  );
  const advise = useStoreSqlAdvise();
  const enableSql = useStoreSql();

  const statsError = errorMessage(stats.error);
  const statsCode = errorCode(stats.error);
  const lockError = errorMessage(locks.error);

  const statementRows = useMemo(
    () => (stats.data?.statements ?? []).map(statementDisplayRow),
    [stats.data?.statements],
  );
  const lockRows = useMemo(() => (locks.data?.rows ?? []).map(lockDisplayRow), [locks.data?.rows]);

  if (!store) {
    return (
      <ExplorerEmpty
        icon={Activity03Icon}
        title="No SQL store"
        description="Query performance reads pg_stat_statements on a postgres-backed SQL store."
      />
    );
  }

  if (statsCode === "PgStatStatementsNotPreloaded") {
    return (
      <ExplorerEmpty
        icon={Activity03Icon}
        title="pg_stat_statements is not preloaded"
        description={
          <>
            Enabling the extension is not enough — add it to{" "}
            <span className="font-mono">shared_preload_libraries</span> at container start, recreate{" "}
            <span className="font-mono">store-sql</span>, then create the extension. Limitation:{" "}
            {statsCode}.
          </>
        }
      />
    );
  }

  if (statsCode === "PgStatStatementsUnsupported") {
    return (
      <ExplorerEmpty
        icon={Activity03Icon}
        title="Engine telemetry unavailable"
        description={
          statsError ??
          "pg_stat_statements is not available on this driver (memory, pglite, or CockroachDB)."
        }
      />
    );
  }

  const advisor = stats.data?.advisor;
  const kpis = stats.data?.kpis;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-slot="store-performance">
      <header className={EXPLORER_STRIP_CLASS}>
        <h2 className={cn(SECTION_HEAD_CLASS, "flex items-center px-2")}>Query performance</h2>
        <span className="font-mono text-[11px] text-muted-foreground">{store.ref}</span>
        <span className="text-[11px] text-muted-foreground" data-slot="locks-polling">
          locks polling
        </span>
        <CallPiiButton
          piiMasked={!lockReveal}
          disabled={locks.isPending}
          onToggle={() => setLockReveal((v) => !v)}
        />
        <AdvisorEnable
          advisor={advisor}
          pending={enableSql.isPending}
          onEnable={() => {
            void enableSql
              .mutateAsync({
                ref: store.ref,
                sql: extensionInstallSql("index_advisor", { cascade: true }),
                allowWrite: true,
                ...(tenant ? { tenant } : {}),
              })
              .then(() => stats.refetch());
          }}
        />
      </header>
      <p
        className="shrink-0 border-b border-border/60 bg-amber-500/8 px-3 py-1.5 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200"
        data-slot="store-sql-stats-pii-gap"
        role="note"
      >
        Engine-native query text from pg_stat_statements (usually{" "}
        <span className="font-mono">$n</span> fingerprints) and live lock activity. Live{" "}
        <span className="font-mono">pg_stat_activity.query</span> can contain literals — collapsed
        until reveal. Limitation: {STORE_SQL_STATS_PII_GAP}. Not the Store browse / projectRun
        guarantee.
      </p>
      <div className={EXPLORER_STRIP_CLASS}>
        <KpiChip
          label="Slow queries"
          value={kpis ? String(kpis.slowQueries) : "—"}
          title="Statements with mean exec ≥ 100ms"
        />
        <KpiChip
          label="Cache hit rate"
          value={formatPct(kpis?.cacheHitRate ?? null)}
          title="shared_blks_hit / (hit + read) across listed statements"
        />
        <KpiChip
          label="Avg rows / call"
          value={kpis?.avgRowsPerCall != null ? kpis.avgRowsPerCall.toFixed(1) : "—"}
          title="sum(rows) / sum(calls)"
        />
      </div>
      <div className="min-h-0 flex-1">
        <QueryResults
          rows={statementRows}
          error={statsCode && statsCode !== "PgStatStatementsNotCreated" ? statsError : null}
          pending={stats.isPending}
          meta={
            stats.data
              ? `${stats.data.rowCount} statements${stats.data.truncated ? " (capped)" : ""}`
              : null
          }
          storeRef={store.ref}
        />
      </div>
      {advisor?.installed && (stats.data?.statements.length ?? 0) > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border/60 px-3 py-1.5">
          <span className="text-[11px] text-muted-foreground">Suggest indexes</span>
          {(stats.data?.statements ?? []).slice(0, 6).map((row, index) => (
            <Button
              key={row.queryid ?? index}
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-none text-[11px]"
              disabled={!row.query || advise.isPending}
              onClick={() => {
                setAdviseFor(row);
                advise.mutate({
                  ref: store.ref,
                  query: row.query ?? "",
                  ...(tenant ? { tenant } : {}),
                });
              }}
              data-slot="store-sql-advise"
            >
              #{index + 1}
            </Button>
          ))}
        </div>
      ) : null}
      {adviseFor ? (
        <AdviseStrip
          query={adviseFor.query}
          result={advise.data ?? null}
          error={errorMessage(advise.error)}
          pending={advise.isPending}
        />
      ) : null}
      <div className="min-h-0 flex-1 border-t border-border/60">
        <QueryResults
          rows={lockRows}
          error={lockError}
          pending={locks.isPending && !locks.data}
          meta={
            locks.data
              ? `${locks.data.rows.length} blocking pair${locks.data.rows.length === 1 ? "" : "s"} · polling`
              : "locks"
          }
          storeRef={store.ref}
        />
      </div>
    </div>
  );
}

function AdvisorEnable({
  advisor,
  pending,
  onEnable,
}: {
  readonly advisor?: { readonly available: boolean; readonly installed: boolean };
  readonly pending: boolean;
  readonly onEnable: () => void;
}): JSX.Element | null {
  const mode = indexAdvisorEnableMode(advisor);
  if (mode === "on") {
    return (
      <span className="ml-auto text-[11px] text-muted-foreground" data-slot="index-advisor-on">
        Index Advisor on
      </span>
    );
  }
  if (mode === "cta") {
    const cataloged = PG_LIBRARY_EXTENSIONS.some((ext) => ext.name === "index_advisor");
    return (
      <p
        className="ml-auto max-w-sm text-right text-[11px] leading-snug text-muted-foreground"
        data-slot="index-advisor-cta"
        role="note"
      >
        Index Advisor is not in <span className="font-mono">pg_available_extensions</span>
        {cataloged ? " — pin oke-postgres-advisor:18-alpine (or supabase/postgres)." : "."}
      </p>
    );
  }
  if (mode !== "enable") return null;
  return (
    <Button
      type="button"
      size="sm"
      className="ml-auto h-full rounded-none"
      disabled={pending}
      onClick={onEnable}
      data-slot="index-advisor-enable"
    >
      Enable Index Advisor
    </Button>
  );
}

function AdviseStrip({
  query,
  result,
  error,
  pending,
}: {
  readonly query: string | null;
  readonly result: StoreSqlAdviseResult | null;
  readonly error: string | null;
  readonly pending: boolean;
}): JSX.Element {
  return (
    <div
      className="shrink-0 border-t border-border/60 px-3 py-2 text-[11px]"
      data-slot="index-advisor-result"
    >
      <p className="truncate font-mono text-muted-foreground">{query}</p>
      {pending ? <p className="mt-1 text-muted-foreground">Advising…</p> : null}
      {error ? <p className="mt-1 text-destructive">{error}</p> : null}
      {result ? (
        <div className="mt-1 flex flex-col gap-0.5">
          <p>
            Cost {fmtCost(result.totalCostBefore)} → {fmtCost(result.totalCostAfter)}
          </p>
          {result.indexStatements.length === 0 ? (
            <p className="text-muted-foreground">No index suggestion.</p>
          ) : (
            result.indexStatements.map((sql) => (
              <div key={sql} className="flex items-start gap-2">
                <code className="min-w-0 flex-1 font-mono text-foreground">{sql}</code>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 rounded-none px-1.5 text-[11px]"
                  onClick={() => void navigator.clipboard.writeText(sql)}
                >
                  Copy
                </Button>
              </div>
            ))
          )}
          {result.errors.map((err) => (
            <p key={err} className="text-destructive">
              {err}
            </p>
          ))}
        </div>
      ) : null}
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

function statementDisplayRow(row: StoreSqlStatementRow): Record<string, unknown> {
  return {
    query: row.query,
    calls: row.calls,
    total_ms: Number(row.totalExecMs.toFixed(2)),
    mean_ms: Number(row.meanExecMs.toFixed(2)),
    max_ms: Number(row.maxExecMs.toFixed(2)),
    min_ms: Number(row.minExecMs.toFixed(2)),
    rows: row.rows,
    cache_hit: formatPct(row.cacheHitRate),
  };
}

function lockDisplayRow(row: {
  readonly blockedPid: number | null;
  readonly blockedUser: string | null;
  readonly blockedQuery: string | null;
  readonly blockingPid: number | null;
  readonly blockingUser: string | null;
  readonly blockingQuery: string | null;
  readonly blockingState: string | null;
}): Record<string, unknown> {
  return {
    blocked_pid: row.blockedPid,
    blocked_user: row.blockedUser,
    blocked_query: row.blockedQuery,
    blocking_pid: row.blockingPid,
    blocking_user: row.blockingUser,
    blocking_query: row.blockingQuery,
    blocking_state: row.blockingState,
  };
}

function formatPct(value: number | null): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function fmtCost(value: unknown): string {
  if (value == null) return "—";
  return String(value);
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}
