/**
 * Progressive-disclosure advanced dimension filters for Traces.
 *
 * Applied clauses are the visualization. Presets toggle them. The raw
 * expression stays out of the way — operators read `trigger = signal`,
 * not a query dump.
 */

import { useMemo, useState } from "react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RunRow } from "@/client.ts";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  BUILDER_DIMENSIONS,
  discoverDimensions,
  formatClause,
  formatClauseValue,
  hasClause,
  parseDimensionQuery,
  removeClause,
  toggleClause,
  upsertClause,
  type DimensionQuery,
  type QueryClause,
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

const FLAT_SELECT =
  "h-7 min-w-0 rounded-none border-0 bg-transparent px-0 font-mono text-[11px] text-foreground shadow-none outline-none focus-visible:ring-0 dark:bg-transparent";

const TEXT_ACTION =
  "rounded-none border-0 bg-transparent p-0 text-[11px] text-foreground/70 shadow-none transition-colors hover:text-foreground";

const CLAUSE_GRID = "grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)_1.25rem] items-center gap-x-1";

/**
 * Advanced filter panel — visual clauses, togglable presets, optional add row.
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
  const [adding, setAdding] = useState(false);

  const addClause = () => {
    const parsed = parseDimensionQuery(`${dim} ${op} ${value}`);
    const clause = parsed.clauses[0];
    if (!clause) return;
    onChange(upsertClause(query, clause));
    setAdding(false);
  };

  return (
    <div
      className="flex flex-col gap-1.5 border-b border-border/60 px-2 py-1.5"
      data-slot="traces-advanced-filters"
    >
      {query.clauses.length > 0 ? (
        <ul aria-label="Active filters" className="flex flex-col gap-0.5">
          {query.clauses.map((clause) => (
            <li key={clause.dimension}>
              <ClauseToken
                clause={clause}
                onRemove={() => onChange(removeClause(query, clause.dimension))}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <div className={CLAUSE_GRID} data-slot="traces-advanced-composer">
          <select
            aria-label="Filter dimension"
            className={FLAT_SELECT}
            value={dim}
            onChange={(e) => setDim(e.target.value)}
          >
            {dimOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter operator"
            className={cn(FLAT_SELECT, "text-center text-foreground/70")}
            value={op}
            onChange={(e) => setOp(e.target.value as QueryOp)}
          >
            {(["=", "!=", ">", "<", ">=", "<="] as const).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <Input
            aria-label="Filter value"
            flat
            className="h-7 px-0 font-mono text-[11px]"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addClause();
            }}
          />
          <button type="button" className={TEXT_ACTION} onClick={addClause}>
            Add
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {ADVANCED_PRESETS.map((preset) => {
          const clause = parseDimensionQuery(preset.expr).clauses[0];
          const active = clause !== undefined && hasClause(query, clause);
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              disabled={clause === undefined}
              onClick={() => {
                if (!clause) return;
                onChange(toggleClause(query, clause));
              }}
              className={cn(
                TEXT_ACTION,
                active ? "font-medium text-foreground" : "text-foreground/70",
              )}
            >
              {preset.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-expanded={adding}
          className={cn(TEXT_ACTION, "ml-auto", adding && "text-foreground")}
          onClick={() => setAdding((open) => !open)}
        >
          {adding ? "Cancel" : "Add clause"}
        </button>
        {query.clauses.length > 0 ? (
          <button
            type="button"
            className={TEXT_ACTION}
            onClick={() => onChange(parseDimensionQuery(""))}
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One applied clause as a readable token — dimension, op, value, remove.
 */
function ClauseToken({
  clause,
  onRemove,
}: {
  readonly clause: QueryClause;
  readonly onRemove: () => void;
}) {
  const label = formatClause(clause);
  return (
    <div className={CLAUSE_GRID} data-slot="traces-advanced-clause">
      <span className="truncate font-mono text-[11px] text-foreground/80">{clause.dimension}</span>
      <span className="text-center font-mono text-[11px] text-foreground/65" aria-hidden>
        {clause.op}
      </span>
      <span className="truncate font-mono text-[11px] text-foreground">
        {formatClauseValue(clause.dimension, clause.value)}
      </span>
      <button
        type="button"
        className={cn(
          TEXT_ACTION,
          "flex size-5 items-center justify-center text-foreground/55 hover:text-destructive",
        )}
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
      </button>
    </div>
  );
}
