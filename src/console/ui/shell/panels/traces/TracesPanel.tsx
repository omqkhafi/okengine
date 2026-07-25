/**
 * Traces panel — folded-time causal chain (console §9.3).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useEffect, useMemo, useState } from "react";
import { createRowBuffer, matchesQuery } from "../../../flows/buffer.ts";
import {
  buildCausalChain,
  groupTraceRoots,
  initialFocusSpanId,
} from "../../../traces/chain.ts";
import { criticalPathSpanIds } from "../../../traces/critical-path.ts";
import {
  parseEffectFilter,
  traceMatchesEffectFilter,
} from "../../../traces/filter.ts";
import {
  foldTimeline,
  intervalsFromSpans,
} from "../../../traces/fold.ts";
import { miniWaterfall, rootErrorCode } from "../../../traces/mini.ts";
import { replayDecision } from "../../../traces/replay.ts";
import {
  boostFlowFully,
  pruneBoosts,
  samplingLabel,
  type FullTraceBoost,
} from "../../../traces/sampling.ts";
import {
  closeTrace,
  expandedFoldsOf,
  openTrace,
  serializeTracesSearch,
  setEffectFilter,
  toggleFold,
  type TracesSearch,
} from "../../../traces/search.ts";
import { peakSpanTier } from "../../../traces/tier.ts";
import type { TraceSpan } from "../../../traces/types.ts";
import { consoleCalls } from "../../client.ts";
import { Button, NewRowsPill } from "../../components/ui.tsx";

/** API row shape from `console.runs.list` (enriched for Traces). */
interface RunsListRow {
  readonly id: string;
  readonly parentId?: string | null;
  readonly flow: string;
  readonly unit?: string | null;
  readonly trigger: string;
  readonly plane: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly error: string | null;
  readonly cost?: number | null;
  readonly sampled?: "full" | "error" | "sample" | "boost";
  readonly effects: ReadonlyArray<{
    readonly kind: TraceSpan["effects"][number]["kind"];
    readonly resource: string;
    readonly timestamp: number;
    readonly duration: number;
    readonly reversibility: TraceSpan["effects"][number]["reversibility"];
  }>;
}

/**
 * Traces panel. List + detail state lives in URL search params.
 */
export function TracesPanel() {
  const search = useSearch({ from: "/traces" }) as TracesSearch;
  const navigate = useNavigate({ from: "/traces" });
  const qc = useQueryClient();
  const [boosts, setBoosts] = useState<FullTraceBoost[]>([]);
  const [buffer] = useState(() => createRowBuffer<TraceSpan>());
  const [pendingCount, setPendingCount] = useState(0);
  const [, setTick] = useState(0);

  const setSearch = (next: TracesSearch) => {
    void navigate({
      search: serializeTracesSearch(next) as never,
      replace: true,
    });
  };

  const runsQuery = useQuery({
    queryKey: ["console.runs.list"],
    queryFn: async () => {
      const res = await consoleCalls.runsList();
      if (res.error) throw new Error(res.error.code);
      return (res.data as { runs: RunsListRow[] }).runs;
    },
    refetchInterval: 5_000,
  });

  const spans = useMemo(
    () => (runsQuery.data ?? []).map(rowToSpan),
    [runsQuery.data],
  );

  // Seed / update buffer without moving the ground (console §7.2).
  useEffect(() => {
    if (spans.length === 0) return;
    if (buffer.visible.length === 0) {
      for (const s of spans) {
        buffer.offer({ id: s.id, value: s, arrivedAt: s.startedAt });
      }
      buffer.flush();
      setPendingCount(0);
      setTick((t) => t + 1);
      return;
    }
    const known = new Set(buffer.visible.map((r) => r.id));
    for (const r of buffer.pending) known.add(r.id);
    for (const s of spans) {
      if (known.has(s.id)) {
        buffer.updateInPlace(s.id, s);
      } else {
        buffer.offer({ id: s.id, value: s, arrivedAt: Date.now() });
      }
    }
    setPendingCount(buffer.pendingCount);
    setTick((t) => t + 1);
  }, [spans, buffer]);

  const visibleSpans = buffer.visible.map((r) => r.value);
  const effectFilter = parseEffectFilter(search.effect);
  const roots = useMemo(() => {
    const all = groupTraceRoots(visibleSpans);
    return all.filter((root) => {
      const textOk = matchesQuery(
        [root.root.flow, root.root.id, rootErrorCode(root.spans) ?? ""],
        search.q,
      );
      const effectOk = traceMatchesEffectFilter(root.spans, effectFilter);
      return textOk && effectOk;
    });
  }, [visibleSpans, search.q, effectFilter]);

  const openRoot =
    roots.find((r) => r.rootId === search.trace) ??
    (search.trace
      ? groupTraceRoots(visibleSpans).find((r) => r.rootId === search.trace)
      : undefined);
  const focusId = openRoot
    ? initialFocusSpanId(openRoot.spans, search.span)
    : undefined;
  const chain = focusId
    ? buildCausalChain(visibleSpans, focusId)
    : null;
  const critical = chain
    ? criticalPathSpanIds(chain.connected)
    : new Set<string>();
  const folded = chain
    ? foldTimeline(
        intervalsFromSpans(chain.connected),
        { expandedFolds: expandedFoldsOf(search) },
        critical,
      )
    : null;
  const decision = chain ? replayDecision(chain.connected) : null;

  const replay = useMutation({
    mutationFn: async () => {
      if (!chain || !decision) return;
      const res = await consoleCalls.tracesReplay({
        rootId: chain.connected[0]?.id ?? chain.current.id,
        dryRun: decision.mode === "dry-run",
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["console.runs.list"] });
    },
  });

  const liveBoosts = pruneBoosts(boosts);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end gap-4 border-b border-[var(--oke-line)] px-6 py-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--oke-muted)]">
            Traces
          </p>
          <h1 className="text-xl font-semibold tracking-tight">
            Causal chain
          </h1>
          <p className="text-xs text-[var(--oke-muted)]">
            Sampling: {samplingLabel(liveBoosts)}
          </p>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--oke-muted)]">Filter by effect</span>
          <select
            aria-label="Filter by effect"
            className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2 text-sm"
            value={search.effect ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setSearch(
                setEffectFilter(search, v ? parseEffectFilter(v) : null),
              );
            }}
          >
            <option value="">All effects</option>
            <option value="wrote:sql:bookings">Wrote sql:bookings</option>
            <option value="sent">Sent (channel)</option>
            <option value="asked">Asked a model</option>
            <option value="secret">Read a secret</option>
            <option value="cost:0.05">Cost &gt; $0.05</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const flow =
                openRoot?.root.flow ??
                roots[0]?.root.flow ??
                "bookings.create";
              setBoosts((b) => boostFlowFully(b, flow));
            }}
          >
            Trace flow fully for 10 minutes
          </Button>
          <NewRowsPill
            count={pendingCount}
            onFlush={() => {
              buffer.flush();
              setPendingCount(0);
              setTick((t) => t + 1);
            }}
          />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section
          aria-label="Trace list"
          className="min-h-0 overflow-auto border-r border-[var(--oke-line)]"
        >
          {runsQuery.isLoading ? (
            <p className="px-6 py-8 text-sm text-[var(--oke-muted)]">
              Loading traces…
            </p>
          ) : roots.length === 0 ? (
            <p className="px-6 py-8 text-sm text-[var(--oke-muted)]">
              No traces yet. Invoke a flow or wait for traffic.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--oke-line)]">
              {roots.map((root) => {
                const err = rootErrorCode(root.spans);
                const bars = miniWaterfall(root.spans);
                const selected = root.rootId === search.trace;
                return (
                  <li key={root.rootId}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      className={clsx(
                        "flex w-full min-h-10 flex-col gap-1 px-4 py-3 text-left text-sm",
                        selected
                          ? "bg-[color-mix(in_oklab,var(--oke-fg)_6%,transparent)]"
                          : "hover:bg-[color-mix(in_oklab,var(--oke-fg)_3%,transparent)]",
                      )}
                      onClick={() => {
                        const focus = initialFocusSpanId(root.spans);
                        setSearch(openTrace(search, root.rootId, focus));
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{root.root.flow}</span>
                        {err ? (
                          <span
                            role="status"
                            className="font-mono text-xs text-[var(--oke-danger)]"
                          >
                            {err}
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-[var(--oke-muted)]">
                            {root.root.durationMs}ms
                          </span>
                        )}
                      </div>
                      <MiniWaterfall bars={bars} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          aria-label="Trace detail"
          className="min-h-0 overflow-auto px-6 py-6"
          aria-live="polite"
        >
          {!chain || !folded ? (
            <p className="text-sm text-[var(--oke-muted)]">
              Select a trace to see the causal chain and folded-time waterfall.
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">
                    {chain.current.flow}
                  </h2>
                  <p className="text-xs text-[var(--oke-muted)]">
                    {chain.connected.length} span
                    {chain.connected.length === 1 ? "" : "s"} · wall{" "}
                    {folded.wallDurationMs}ms · display scale{" "}
                    {Math.round(folded.displayDurationMs)}ms
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={
                      decision?.mode === "dry-run" ? "external" : "primary"
                    }
                    disabled={replay.isPending}
                    title={
                      decision?.mode === "dry-run"
                        ? decision.reason
                        : "Replay from the journal"
                    }
                    onClick={() => replay.mutate()}
                  >
                    {decision?.mode === "dry-run"
                      ? "Dry-run replay"
                      : "Replay"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setSearch(closeTrace(search))}
                  >
                    Close
                  </Button>
                </div>
              </div>

              {decision?.mode === "dry-run" ? (
                <p
                  role="note"
                  className="text-sm text-[var(--oke-external)]"
                >
                  {decision.reason}
                </p>
              ) : null}

              <div>
                <h3 className="mb-2 text-sm font-medium">Causal chain</h3>
                <ol className="flex flex-col gap-1 border-l border-[var(--oke-line)] pl-4">
                  {chain.parents.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="min-h-8 text-sm text-[var(--oke-muted)]"
                        onClick={() =>
                          setSearch({ ...search, span: p.id })
                        }
                      >
                        {p.flow}
                      </button>
                    </li>
                  ))}
                  <li aria-current="true">
                    <span className="text-sm font-medium">
                      {chain.current.flow}
                    </span>
                    {chain.current.errorCode ? (
                      <span
                        role="status"
                        className="ml-2 font-mono text-xs text-[var(--oke-danger)]"
                      >
                        {chain.current.errorCode}
                      </span>
                    ) : null}
                    {peakSpanTier(chain.current.effects) === "external" ? (
                      <span aria-label="external effect"> ↗</span>
                    ) : null}
                  </li>
                  {chain.children.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="min-h-8 text-sm text-[var(--oke-muted)]"
                        onClick={() =>
                          setSearch({ ...search, span: c.id })
                        }
                      >
                        {c.flow}
                        {peakSpanTier(c.effects) === "external" ? (
                          <span aria-label="external effect"> ↗</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <h3
                  id="waterfall-heading"
                  className="mb-2 text-sm font-medium"
                >
                  Waterfall
                </h3>
                <ul
                  aria-labelledby="waterfall-heading"
                  className="flex min-h-10 list-none items-stretch gap-0.5 p-0"
                >
                  {folded.segments.map((seg) => {
                    if (seg.kind === "fold") {
                      return (
                        <li
                          key={seg.id}
                          style={{
                            flex: `${seg.displayMs} 1 0`,
                            minWidth: 24,
                          }}
                        >
                          <button
                            type="button"
                            aria-expanded={seg.expanded}
                            className="h-full min-h-10 w-full border border-dashed border-[var(--oke-line)] px-1 font-mono text-[10px] text-[var(--oke-muted)]"
                            onClick={() =>
                              setSearch(toggleFold(search, seg.id))
                            }
                          >
                            {seg.label}
                          </button>
                        </li>
                      );
                    }
                    return (
                      <li
                        key={seg.id}
                        title={seg.label}
                        className={clsx(
                          "min-h-10 px-1 text-[10px] leading-10",
                          seg.tier === "external"
                            ? "bg-[var(--oke-external)] text-black"
                            : "bg-[color-mix(in_oklab,var(--oke-accent)_55%,transparent)]",
                          seg.failed &&
                            "outline outline-2 outline-[var(--oke-danger)]",
                        )}
                        style={{
                          flex: `${seg.displayMs} 1 0`,
                          opacity: seg.critical ? 1 : 0.38,
                          minWidth: 4,
                        }}
                      >
                        <span className="sr-only">
                          {seg.label}
                          {seg.critical ? " (critical path)" : ""}
                          {seg.failed ? " (failed)" : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-xs text-[var(--oke-muted)]">
                  Critical path at full opacity · dead time folded into
                  expandable bars
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function rowToSpan(row: RunsListRow): TraceSpan {
  return {
    id: row.id,
    ...(row.parentId ? { parentId: row.parentId } : {}),
    flow: row.flow,
    ...(row.unit ? { unit: row.unit } : {}),
    trigger: row.trigger,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMs: row.durationMs,
    errorCode: row.error,
    cost: row.cost ?? undefined,
    sampled: row.sampled ?? (row.error ? "error" : "sample"),
    effects: row.effects ?? [],
  };
}

function MiniWaterfall({
  bars,
}: {
  readonly bars: ReturnType<typeof miniWaterfall>;
}) {
  return (
    <div
      aria-hidden="true"
      className="relative h-2 w-full overflow-hidden bg-[color-mix(in_oklab,var(--oke-fg)_6%,transparent)]"
    >
      {bars.map((bar, i) => (
        <span
          key={i}
          className={clsx(
            "absolute inset-y-0",
            bar.tier === "external"
              ? "bg-[var(--oke-external)]"
              : bar.failed
                ? "bg-[var(--oke-danger)]"
                : "bg-[var(--oke-accent)]",
          )}
          style={{
            left: `${bar.start * 100}%`,
            width: `${Math.max(2, bar.width * 100)}%`,
          }}
        />
      ))}
    </div>
  );
}
