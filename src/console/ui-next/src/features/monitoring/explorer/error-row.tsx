/**
 * One aggregated-error row — TraceRow rail + count, opens the latest run.
 */

import type { JSX } from "react";
import { Link } from "@tanstack/react-router";
import {
  EXPLORER_RAIL_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_ROW_SELECTED_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
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
        "group relative flex w-full items-stretch border-b border-border/60 text-xs",
        selected && "bg-muted/70",
      )}
    >
      <span aria-hidden className={cn(EXPLORER_RAIL_CLASS, "bg-destructive")} />
      <button
        type="button"
        onClick={() => onSelect(group)}
        className={cn(
          EXPLORER_ROW_CLASS,
          "min-w-0 flex-1 py-2 pr-2 pl-3",
          selected && EXPLORER_ROW_SELECTED_CLASS,
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          <span className="font-mono text-[11px] text-foreground">{group.flow}</span>
          {group.errorMessage ? (
            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
              {group.errorMessage}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 font-mono tabular-nums text-[10px] text-muted-foreground">
          {group.count}
        </span>
        <span className="w-12 shrink-0 text-right text-[10px] text-muted-foreground">
          {formatAgo(group.latestStartedAt, nowMs)}
        </span>
      </button>
      <Link
        to="/overview"
        search={{ run: group.latestRunId }}
        className="flex items-center px-2 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
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
