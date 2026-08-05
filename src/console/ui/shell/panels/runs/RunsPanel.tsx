/**
 * Runs panel — population analysis of wide events (console §9.11).
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useEffect, useMemo, useState } from "react";
import {
  BUILDER_DIMENSIONS,
  closeRun,
  dimensionQueryOf,
  discoverDimensions,
  durationHistogram,
  durationRangeOf,
  errorPatterns,
  explainDurationOutliers,
  filterRuns,
  filterRunsSince,
  formatDurationMs,
  groupByDimension,
  normalizeRange,
  openRun,
  parseDimensionQuery,
  parseSinceWindowMs,
  removeClause,
  rowToRun,
  serializeRunsSearch,
  setDurationRange,
  setGroup,
  setSince,
  setWhere,
  rootIdOf,
  shouldOfferTracesLink,
  upsertClause,
  type QueryOp,
  type RunRecord,
  type RunsListRow,
  type RunsSearch,
} from "../../../runs/index.ts";
import { consoleCalls } from "../../client.ts";
import { Button } from "../../components/ui.tsx";

/**
 * Runs panel. Query / group / brush / detail state lives in URL search params.
 */
export function RunsPanel() {
  const search = useSearch({ from: "/runs" }) as RunsSearch;
  const navigate = useNavigate({ from: "/runs" });

  const setSearch = (next: RunsSearch) => {
    void navigate({
      search: serializeRunsSearch(next) as never,
      replace: true,
    });
  };

  const runsQuery = useQuery({
    queryKey: ["console.runs.list"],
    queryFn: async () => {
      const res = await consoleCalls.runsList();
      if (res.error) throw new Error(res.error.code);
      return (res.data as { runs: RunsListRow[] }).runs.map(rowToRun);
    },
    refetchInterval: 5_000,
  });

  const allRuns = runsQuery.data ?? [];
  const query = dimensionQueryOf(search);
  const sinceParam = search.since ?? "1h";
  const windowMs = parseSinceWindowMs(sinceParam === "" ? undefined : sinceParam);
  const sinceMs =
    windowMs === undefined
      ? undefined
      : /^\d+$/.test(sinceParam.trim())
        ? windowMs
        : Date.now() - windowMs;
  const windowed = useMemo(() => filterRunsSince(allRuns, sinceMs), [allRuns, sinceMs]);
  const filtered = useMemo(() => filterRuns(windowed, query), [windowed, query]);
  const range = durationRangeOf(search);
  const buckets = useMemo(() => durationHistogram(filtered), [filtered]);
  const maxBucket = Math.max(1, ...buckets.map((b) => b.count));
  const groups = useMemo(
    () => (search.group ? groupByDimension(filtered, search.group) : []),
    [filtered, search.group],
  );
  const patterns = useMemo(
    () => errorPatterns(windowed, Date.now(), windowMs ?? 60 * 60 * 1000),
    [windowed, windowMs],
  );
  const findings = useMemo(
    () => (range ? explainDurationOutliers(filtered, range) : []),
    [filtered, range],
  );
  const dimensions = useMemo(() => discoverDimensions(allRuns), [allRuns]);
  const open = allRuns.find((r) => r.id === search.run);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end gap-4 border-b border-[var(--oke-line)] px-6 py-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--oke-muted)]">Runs</p>
          <h1 className="text-xl font-semibold tracking-tight">Population analysis</h1>
          <p className="text-xs text-[var(--oke-muted)]">
            {filtered.length} of {allRuns.length} runs · wide events, not log lines
          </p>
        </div>
        <QueryBuilder search={search} dimensions={dimensions} onChange={setSearch} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--oke-muted)]">Since</span>
          <select
            aria-label="Lookback window"
            className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2 text-sm"
            value={sinceParam}
            onChange={(e) => {
              const v = e.target.value;
              setSearch(setSince(search, v === "" ? "" : v));
            }}
          >
            <option value="5m">Last 5m</option>
            <option value="1h">Last 1h</option>
            <option value="24h">Last 24h</option>
            <option value="">All time</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--oke-muted)]">Group by</span>
          <select
            aria-label="Group by dimension"
            className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2 text-sm"
            value={search.group ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setSearch(setGroup(search, v || null));
            }}
          >
            <option value="">None</option>
            {dimensions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="min-h-0 overflow-auto border-r border-[var(--oke-line)] px-6 py-6">
          <section aria-label="Duration distribution" className="mb-8">
            <h2 className="mb-2 text-sm font-medium">Duration distribution</h2>
            <p className="mb-3 text-xs text-[var(--oke-muted)]">
              Range-select a region to explain outliers against the rest.
            </p>
            {runsQuery.isLoading ? (
              <p className="text-sm text-[var(--oke-muted)]">Loading runs…</p>
            ) : buckets.length === 0 ? (
              <p className="text-sm text-[var(--oke-muted)]">No runs match the current query.</p>
            ) : (
              <DurationChart
                buckets={buckets}
                maxBucket={maxBucket}
                range={range}
                onSelect={(next) => setSearch(setDurationRange(search, next))}
              />
            )}
            {range ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="text-xs text-[var(--oke-muted)]">
                  Selected {formatDurationMs(range.minMs)} – {formatDurationMs(range.maxMs)}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSearch(setDurationRange(search, null))}
                >
                  Clear selection
                </Button>
              </div>
            ) : null}
          </section>

          {range ? (
            <section aria-label="Outlier explanation" className="mb-8">
              <h2 className="mb-2 text-sm font-medium">Outlier explanation</h2>
              {findings.length === 0 ? (
                <p className="text-sm text-[var(--oke-muted)]">
                  No dimension separates this region strongly enough.
                </p>
              ) : (
                <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
                  {findings.map((f) => (
                    <li key={`${f.dimension}:${f.value}`}>{f.explanation}</li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}

          <section aria-label="Error patterns" className="mb-8">
            <h2 className="mb-2 text-sm font-medium">Error patterns</h2>
            <p className="mb-3 text-xs text-[var(--oke-muted)]">
              Failed runs in the selected window, grouped by error code.
            </p>
            {patterns.length === 0 ? (
              <p className="text-sm text-[var(--oke-muted)]">No errors in this window.</p>
            ) : (
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--oke-line)] text-[var(--oke-muted)]">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Error
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Count
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      p99
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--oke-line)]">
                  {patterns.map((p) => (
                    <tr key={p.key}>
                      <td className="py-2 pr-3 font-mono text-xs text-[var(--oke-danger)]">
                        {p.key}
                      </td>
                      <td className="py-2 pr-3">{p.count}</td>
                      <td className="py-2">{formatDurationMs(p.p99DurationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {search.group ? (
            <section aria-label="Group aggregates" className="mb-8">
              <h2 className="mb-2 text-sm font-medium">Group by {search.group}</h2>
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--oke-line)] text-[var(--oke-muted)]">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      {search.group}
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Count
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Avg
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      p50
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      p99
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--oke-line)]">
                  {groups.map((g) => (
                    <tr key={g.key}>
                      <td className="py-2 pr-3 font-mono text-xs">{g.key}</td>
                      <td className="py-2 pr-3">{g.count}</td>
                      <td className="py-2 pr-3">{formatDurationMs(g.avgDurationMs)}</td>
                      <td className="py-2 pr-3">{formatDurationMs(g.p50DurationMs)}</td>
                      <td className="py-2 pr-3">{formatDurationMs(g.p99DurationMs)}</td>
                      <td className="py-2">{g.sumCost > 0 ? `$${g.sumCost.toFixed(3)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <section aria-label="Run list">
            <h2 className="mb-2 text-sm font-medium">Runs</h2>
            {filtered.length === 0 ? (
              <p className="text-sm text-[var(--oke-muted)]">
                No runs yet. Invoke a flow or widen the query.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--oke-line)]">
                {filtered.slice(0, 200).map((run) => {
                  const selected = run.id === search.run;
                  return (
                    <li key={run.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        className={clsx(
                          "flex w-full min-h-10 items-center justify-between gap-3 px-2 py-2 text-left text-sm",
                          selected
                            ? "bg-[color-mix(in_oklab,var(--oke-fg)_6%,transparent)]"
                            : "hover:bg-[color-mix(in_oklab,var(--oke-fg)_3%,transparent)]",
                        )}
                        onClick={() => setSearch(openRun(search, run.id))}
                      >
                        <span className="font-medium">{run.flow}</span>
                        <span className="flex items-center gap-3 font-mono text-xs text-[var(--oke-muted)]">
                          <span>{run.cache}</span>
                          {run.error ? (
                            <span role="status" className="text-[var(--oke-danger)]">
                              {run.error}
                            </span>
                          ) : (
                            <span>{formatDurationMs(run.durationMs)}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <section
          aria-label="Run detail"
          className="min-h-0 overflow-auto px-6 py-6"
          aria-live="polite"
        >
          {!open ? (
            <p className="text-sm text-[var(--oke-muted)]">
              Select a run to see its flat dimension record.
            </p>
          ) : (
            <RunDetail run={open} allRuns={allRuns} onClose={() => setSearch(closeRun(search))} />
          )}
        </section>
      </div>
    </div>
  );
}

function QueryBuilder({
  search,
  dimensions,
  onChange,
}: {
  readonly search: RunsSearch;
  readonly dimensions: readonly string[];
  readonly onChange: (next: RunsSearch) => void;
}) {
  const query = dimensionQueryOf(search);
  const dimOptions = [...new Set([...BUILDER_DIMENSIONS, ...dimensions])].sort();
  const [dim, setDim] = useState<string>("cache");
  const [op, setOp] = useState<QueryOp>("=");
  const [value, setValue] = useState("miss");
  const [exprDraft, setExprDraft] = useState(search.where ?? "");

  useEffect(() => {
    setExprDraft(search.where ?? "");
  }, [search.where]);

  return (
    <div className="flex min-w-[16rem] flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--oke-muted)]">Dimension</span>
          <select
            aria-label="Query dimension"
            className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2 text-sm"
            value={dim}
            onChange={(e) => setDim(e.target.value)}
          >
            {dimOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--oke-muted)]">Op</span>
          <select
            aria-label="Query operator"
            className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2 text-sm"
            value={op}
            onChange={(e) => setOp(e.target.value as QueryOp)}
          >
            {(["=", "!=", ">", "<", ">=", "<="] as const).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-sm">
          <span className="text-[var(--oke-muted)]">Value</span>
          <input
            aria-label="Query value"
            className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2 text-sm"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const parsed = parseDimensionQuery(`${dim} ${op} ${value}`);
            const clause = parsed.clauses[0];
            if (!clause) return;
            const next = setWhere(search, upsertClause(query, clause));
            setExprDraft(next.where ?? "");
            onChange(next);
          }}
        >
          Add
        </Button>
      </div>

      {query.clauses.length > 0 ? (
        <ul aria-label="Active query clauses" className="flex flex-wrap gap-2">
          {query.clauses.map((c) => (
            <li key={c.dimension}>
              <button
                type="button"
                className="min-h-8 border border-[var(--oke-line)] px-2 font-mono text-xs"
                onClick={() => {
                  const next = setWhere(search, removeClause(query, c.dimension));
                  setExprDraft(next.where ?? "");
                  onChange(next);
                }}
              >
                {c.dimension} {c.op} {String(c.value)} ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--oke-muted)]">Dimension query expression</span>
        <input
          aria-label="Dimension query expression"
          className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2 font-mono text-sm"
          placeholder="flow = X AND cache = miss AND duration > 1s"
          value={exprDraft}
          onChange={(e) => setExprDraft(e.target.value)}
          onBlur={() => {
            const parsed = parseDimensionQuery(exprDraft);
            onChange(setWhere(search, parsed));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const parsed = parseDimensionQuery(exprDraft);
              onChange(setWhere(search, parsed));
            }
          }}
        />
      </label>
    </div>
  );
}

function DurationChart({
  buckets,
  maxBucket,
  range,
  onSelect,
}: {
  readonly buckets: ReturnType<typeof durationHistogram>;
  readonly maxBucket: number;
  readonly range: ReturnType<typeof durationRangeOf>;
  readonly onSelect: (range: ReturnType<typeof normalizeRange> | null) => void;
}) {
  const [anchor, setAnchor] = useState<number | null>(null);

  return (
    <div
      role="group"
      aria-label="Duration histogram"
      className="flex h-40 items-end gap-px border border-[var(--oke-line)] bg-[color-mix(in_oklab,var(--oke-fg)_3%,transparent)] p-2"
      onMouseLeave={() => setAnchor(null)}
    >
      {buckets.map((b, i) => {
        const selected = range !== null && b.minMs <= range.maxMs && b.maxMs >= range.minMs;
        const height = Math.max(4, (b.count / maxBucket) * 100);
        return (
          <button
            key={i}
            type="button"
            title={`${formatDurationMs(b.minMs)}–${formatDurationMs(b.maxMs)}: ${b.count}`}
            aria-label={`Duration ${formatDurationMs(b.minMs)} to ${formatDurationMs(b.maxMs)}, ${b.count} runs`}
            aria-pressed={selected}
            className={clsx(
              "min-h-2 min-w-2 flex-1",
              selected
                ? "bg-[var(--oke-accent)]"
                : "bg-[color-mix(in_oklab,var(--oke-fg)_35%,transparent)]",
            )}
            style={{ height: `${height}%` }}
            onMouseDown={() => setAnchor(b.minMs)}
            onMouseEnter={() => {
              if (anchor === null) return;
              onSelect(normalizeRange(anchor, b.maxMs));
            }}
            onMouseUp={() => {
              if (anchor === null) {
                onSelect(normalizeRange(b.minMs, b.maxMs));
              } else {
                onSelect(normalizeRange(anchor, b.maxMs));
              }
              setAnchor(null);
            }}
            onClick={() => {
              // click without drag selects the bar
              if (anchor === null) {
                onSelect(normalizeRange(b.minMs, b.maxMs));
              }
            }}
          />
        );
      })}
    </div>
  );
}

function RunDetail({
  run,
  allRuns,
  onClose,
}: {
  readonly run: RunRecord;
  readonly allRuns: readonly RunRecord[];
  readonly onClose: () => void;
}) {
  const offerTraces = shouldOfferTracesLink(allRuns, run.id);
  const fields: Array<{ readonly label: string; readonly value: string }> = [
    { label: "flow", value: run.flow },
    { label: "unit", value: run.unit ?? "—" },
    { label: "trigger", value: run.trigger },
    { label: "plane", value: run.plane },
    { label: "tenant", value: run.tenant ?? "—" },
    { label: "principal", value: run.principal ?? "—" },
    { label: "gates", value: run.gates.length ? run.gates.join(", ") : "—" },
    { label: "cache", value: run.cache },
    {
      label: "replica",
      value:
        run.replica != null
          ? `${run.replica}${run.replicaLagMs != null ? ` · lag ${run.replicaLagMs}ms` : ""}`
          : "—",
    },
    {
      label: "cost",
      value: run.cost != null ? `$${run.cost.toFixed(4)}` : "—",
    },
    {
      label: "promptVersion",
      value: run.promptVersion != null ? String(run.promptVersion) : "—",
    },
    { label: "buildVersion", value: run.buildVersion ?? "—" },
    {
      label: "duration",
      value: formatDurationMs(run.durationMs),
    },
    { label: "error", value: run.error ?? "—" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{run.flow}</h2>
          <p className="font-mono text-xs text-[var(--oke-muted)]">{run.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {offerTraces ? (
            <Link
              to="/traces"
              search={{
                trace: rootIdOf(allRuns, run.id),
                span: run.id,
              }}
              className="inline-flex min-h-8 items-center border border-[var(--oke-line)] px-3 text-sm"
            >
              Open in Traces
            </Link>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-4 gap-y-2 text-sm">
        {fields.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-[var(--oke-muted)]">{f.label}</dt>
            <dd
              className={clsx(
                "font-mono text-xs",
                f.label === "error" && run.error ? "text-[var(--oke-danger)]" : "",
              )}
            >
              {f.value}
            </dd>
          </div>
        ))}
      </dl>

      <div>
        <h3 className="mb-2 text-sm font-medium">Effects</h3>
        {run.effects.length === 0 ? (
          <p className="text-sm text-[var(--oke-muted)]">None</p>
        ) : (
          <ul className="divide-y divide-[var(--oke-line)] text-sm">
            {run.effects.map((e, i) => (
              <li
                key={`${e.kind}:${e.resource}:${i}`}
                className="flex min-h-8 items-center justify-between gap-3 py-1"
              >
                <span>
                  {e.kind} <span className="font-mono text-xs">{e.resource}</span>
                </span>
                <span className="font-mono text-xs text-[var(--oke-muted)]">
                  {e.duration}ms · {e.reversibility}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="group">
        <summary className="cursor-pointer text-sm font-medium">fx.log ({run.logs.length})</summary>
        {run.logs.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--oke-muted)]">No log lines</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--oke-line)] font-mono text-xs">
            {run.logs.map((line, i) => (
              <li key={i} className="py-2">
                <span className="text-[var(--oke-muted)]">[{line.level}]</span> {line.message}
                {line.data ? (
                  <pre className="mt-1 whitespace-pre-wrap text-[var(--oke-muted)]">
                    {JSON.stringify(line.data, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
