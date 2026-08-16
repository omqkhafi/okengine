/**
 * One aggregated-error row — TraceRow rail + count, opens the latest run.
 */

import type { JSX } from "react";
import { Link } from "@tanstack/react-router";
import { EXPLORER_RAIL_CLASS } from "@/components/explorer/explorer-chrome.ts";
import { cn } from "@/lib/utils.ts";
import type { TopErrorGroup } from "../lib/top-errors.ts";

/** Props for {@link ErrorRow}. */
export interface ErrorRowProps {
  readonly group: TopErrorGroup;
  readonly selected: boolean;
  readonly nowMs: number;
  readonly onSelect: (group: TopErrorGroup) => void;
}

/**
 * Failed-rail row for one error + flow group.
 *
 * @param props - Group + selection
 */
export function ErrorRow({ group, selected, nowMs, onSelect }: ErrorRowProps): JSX.Element {
  return (
    <div
      data-slot="monitoring-error-row"
      data-error-key={group.key}
      data-selected={selected ? "true" : "false"}
      className={cn(
        "group relative flex w-full items-stretch border-b border-border/60 text-xs transition-colors",
        "hover:bg-muted/50 focus-within:bg-muted/50",
        selected && "bg-muted/70",
      )}
    >
      <span aria-hidden className={cn(EXPLORER_RAIL_CLASS, "bg-destructive")} />
      <button
        type="button"
        onClick={() => onSelect(group)}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 pl-0 text-left outline-none"
      >
        <span className="ml-2.5 size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-foreground">{group.flow}</span>
          {group.errorMessage ? (
            <span className="text-muted-foreground"> · {group.errorMessage}</span>
          ) : null}
        </span>
        <span className="w-8 shrink-0 text-right font-mono tabular-nums text-[10px] text-muted-foreground">
          {group.count}
        </span>
        <span className="w-10 shrink-0 truncate text-right text-[10px] text-muted-foreground">
          {formatAgo(group.latestStartedAt, nowMs)}
        </span>
      </button>
      <Link
        to="/overview"
        search={{ run: group.latestRunId }}
        className={cn(
          "flex items-center px-2 text-[10px] text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
        )}
        data-slot="monitoring-error-open-overview"
        onClick={(event) => event.stopPropagation()}
      >
        Overview
      </Link>
    </div>
  );
}

/**
 * Relative age for the newest in-group run.
 *
 * @param startedAt - Epoch ms
 * @param nowMs - Clock
 */
function formatAgo(startedAt: number, nowMs: number): string {
  const delta = Math.max(0, nowMs - startedAt);
  if (delta < 60_000) return `${Math.max(1, Math.round(delta / 1000))}s`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m`;
  return `${Math.round(delta / 3_600_000)}h`;
}
