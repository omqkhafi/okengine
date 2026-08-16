/**
 * Recent activity strip — flush briefing under the Units identity header.
 */

import type { JSX, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { RunRow } from "@/client.ts";
import {
  EXPLORER_STRIP_CLASS,
  EXPLORER_STRIP_TOKEN_CLASS,
  EXPLORER_STRIP_TOKEN_IDLE_CLASS,
  SECTION_HEAD_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { cn } from "@/lib/utils.ts";
import {
  FLOW_ACTIVITY_WINDOW_MS,
  flowActivitySummary,
  type FlowActivitySummary,
} from "../lib/flow-activity.ts";

/** Props for {@link FlowActivityStrip}. */
export interface FlowActivityStripProps {
  readonly flowId: string;
  readonly runs: readonly RunRow[] | undefined;
  /** Injected clock for tests; defaults to `Date.now()`. */
  readonly nowMs?: number;
  readonly windowMs?: number;
  /** Plane / durable / live tokens sit on the same row. */
  readonly children?: ReactNode;
}

/**
 * Compact activity indicator at the top of the contract panel.
 *
 * @param props - Flow id + runs buffer
 */
export function FlowActivityStrip({
  flowId,
  runs,
  nowMs = Date.now(),
  windowMs = FLOW_ACTIVITY_WINDOW_MS,
  children,
}: FlowActivityStripProps): JSX.Element {
  const summary = flowActivitySummary(runs ?? [], flowId, nowMs, windowMs);
  return (
    <div
      className={cn(EXPLORER_STRIP_CLASS, "px-2")}
      data-slot="flow-activity-strip"
      data-kind={summary.kind}
      aria-label="Recent activity"
    >
      <span className={cn(SECTION_HEAD_CLASS, "flex items-center")}>Activity</span>
      <ActivityBody summary={summary} nowMs={nowMs} />
      {children ? <div className="ml-auto flex h-full items-stretch">{children}</div> : null}
    </div>
  );
}

function ActivityBody({
  summary,
  nowMs,
}: {
  readonly summary: FlowActivitySummary;
  readonly nowMs: number;
}): JSX.Element {
  if (summary.kind === "empty") {
    return (
      <p
        className="flex items-center text-[11px] text-muted-foreground"
        data-slot="flow-activity-empty"
      >
        No recent runs in the Console buffer.
      </p>
    );
  }

  const pct = Math.round(summary.errorRate * 100);
  const ago = formatAgo(summary.lastStartedAt, nowMs);
  return (
    <p className="flex min-w-0 items-center gap-x-2 text-[11px] text-foreground/85">
      <span className="tabular-nums" data-slot="flow-activity-calls">
        {summary.calls} call{summary.calls === 1 ? "" : "s"}
      </span>
      <span className="text-muted-foreground" aria-hidden>
        ·
      </span>
      <span className="tabular-nums" data-slot="flow-activity-errors">
        {pct}% errors
      </span>
      <span className="text-muted-foreground" aria-hidden>
        ·
      </span>
      <span className="text-muted-foreground" data-slot="flow-activity-ago">
        {ago}
      </span>
      <Link
        to="/overview"
        search={{ run: summary.latestRunId }}
        className={cn(EXPLORER_STRIP_TOKEN_CLASS, EXPLORER_STRIP_TOKEN_IDLE_CLASS)}
        data-slot="flow-activity-open-run"
      >
        Open latest
      </Link>
    </p>
  );
}

/**
 * Relative age for the newest in-window run.
 *
 * @param startedAt - Epoch ms
 * @param nowMs - Clock
 */
function formatAgo(startedAt: number, nowMs: number): string {
  const delta = Math.max(0, nowMs - startedAt);
  if (delta < 60_000) return `${Math.max(1, Math.round(delta / 1000))}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return `${Math.round(delta / 3_600_000)}h ago`;
}
