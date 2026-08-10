/**
 * Progressive-disclosure advanced dimension filters for Traces.
 *
 * Always-on controls stay in the header; Advanced expands the Runs-style
 * dimension query builder (chips + expression) over the scoped list.
 */

import { useEffect, useMemo, useState } from "react";
import type { RunRow } from "@/client.ts";
import { cn } from "@/lib/utils";
import {
  BUILDER_DIMENSIONS,
  discoverDimensions,
  formatClause,
  parseDimensionQuery,
  removeClause,
  serializeDimensionQuery,
  upsertClause,
  type DimensionQuery,
  type QueryOp,
} from "./dimension-query.ts";

/** One-click advanced presets over the seeded / live population. */
const ADVANCED_PRESETS: readonly {
  readonly id: string;
  readonly label: string;
  readonly expr: string;
}[] = [
  { id: "signal", label: "Signal", expr: "trigger = signal" },
  { id: "clock", label: "Clock", expr: "trigger = cron" },
  { id: "cache-miss", label: "Cache miss", expr: "cache = miss" },
  { id: "slow", label: "Slow", expr: "duration > 100ms" },
];

/**
 * Advanced filter panel — dimension builder + chips + expression.
 *
 * @param props - Query state, run population for discovered dimensions
 */
export function AdvancedFilters({
  query,
  runs,
  onChange,
}: {
  readonly query: DimensionQuery;
  readonly runs: readonly RunRow[];
  readonly onChange: (next: DimensionQuery) => void;
}) {
  const dimensions = useMemo(() => discoverDimensions(runs), [runs]);
  const dimOptions = useMemo(
    () => [...new Set([...BUILDER_DIMENSIONS, ...dimensions])].sort(),
    [dimensions],
  );

  const [dim, setDim] = useState<string>("trigger");
  const [op, setOp] = useState<QueryOp>("=");
  const [value, setValue] = useState("signal");
  const [exprDraft, setExprDraft] = useState(() => serializeDimensionQuery(query));

  useEffect(() => {
    setExprDraft(serializeDimensionQuery(query));
  }, [query]);

  const commitExpr = (raw: string) => {
    onChange(parseDimensionQuery(raw));
  };

  const addClause = () => {
    const parsed = parseDimensionQuery(`${dim} ${op} ${value}`);
    const clause = parsed.clauses[0];
    if (!clause) return;
    onChange(upsertClause(query, clause));
  };

  return (
    <div
      className="flex flex-col gap-2 border-b border-border/60 bg-muted/20 px-3 py-2"
      data-slot="traces-advanced-filters"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Advanced
        </span>
        {ADVANCED_PRESETS.map((preset) => {
          const active = serializeDimensionQuery(query) === preset.expr;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(parseDimensionQuery(preset.expr))}
              className={cn(
                "rounded-md border px-1.5 py-0.5 text-[10px] transition-colors",
                active
                  ? "border-foreground/30 bg-background text-foreground shadow-sm"
                  : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {preset.label}
            </button>
          );
        })}
        {query.clauses.length > 0 ? (
          <button
            type="button"
            className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => onChange(parseDimensionQuery(""))}
          >
            Clear
          </button>
        ) : null}
      </div>

      {query.clauses.length > 0 ? (
        <ul aria-label="Active advanced filter clauses" className="flex flex-wrap gap-1.5">
          {query.clauses.map((c) => (
            <li key={c.dimension}>
              <button
                type="button"
                className="rounded-md border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                onClick={() => onChange(removeClause(query, c.dimension))}
                title="Remove clause"
              >
                {formatClause(c)} ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-end gap-1.5">
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[9px] text-muted-foreground">Dimension</span>
          <select
            aria-label="Filter dimension"
            className="h-6 max-w-[7rem] rounded-md border border-border/70 bg-transparent px-1 text-[10px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
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
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] text-muted-foreground">Op</span>
          <select
            aria-label="Filter operator"
            className="h-6 rounded-md border border-border/70 bg-transparent px-1 text-[10px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
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
        <label className="flex min-w-[5rem] flex-1 flex-col gap-0.5">
          <span className="text-[9px] text-muted-foreground">Value</span>
          <input
            aria-label="Filter value"
            className="h-6 rounded-md border border-border/70 bg-transparent px-1.5 text-[10px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addClause();
            }}
          />
        </label>
        <button
          type="button"
          onClick={addClause}
          className="h-6 rounded-md border border-border/70 bg-background px-2 text-[10px] font-medium text-foreground hover:bg-muted"
        >
          Add
        </button>
      </div>

      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] text-muted-foreground">Expression</span>
        <input
          aria-label="Dimension query expression"
          className="h-6 rounded-md border border-border/70 bg-transparent px-1.5 font-mono text-[10px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          placeholder="flow = X AND cache = miss AND duration > 1s"
          value={exprDraft}
          onChange={(e) => setExprDraft(e.target.value)}
          onBlur={() => commitExpr(exprDraft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitExpr(exprDraft);
          }}
        />
      </label>
    </div>
  );
}
