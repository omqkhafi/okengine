/**
 * AI usage rail — journal cost when present, otherwise honest empty.
 *
 * Token counts are not on EffectEntry. Cost on WideEvent is not populated
 * from fx.ask today. This rail must not invent $0.
 */

import type { JSX } from "react";
import type { AiListPayload } from "@/client.ts";
import type { AskCount } from "../lib/ask-count.ts";

/** Props for {@link AiRail}. */
export interface AiRailProps {
  readonly ai: AiListPayload | undefined;
  readonly asks: AskCount;
}

/**
 * Compact AI strip above the charts.
 *
 * @param props - GET /console/ai payload + ask-effect count
 */
export function AiRail({ ai, asks }: AiRailProps): JSX.Element {
  const sampled = (ai?.versions ?? []).filter((v) => v.sampleCount > 0);
  const mean =
    sampled.length === 0 ? null : sampled.reduce((sum, v) => sum + v.cost.mean, 0) / sampled.length;

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-3 py-1.5"
      data-slot="monitoring-ai-rail"
      aria-label="AI usage"
    >
      <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        AI
      </span>
      {mean == null ? (
        <p className="text-[11px] text-muted-foreground" data-slot="monitoring-ai-empty">
          No cost samples in the Console AI journal.
        </p>
      ) : (
        <p className="text-[11px] text-foreground/85" data-slot="monitoring-ai-cost">
          <span className="tabular-nums">mean {formatCost(mean)}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="tabular-nums">{sampled.length} version</span>
        </p>
      )}
      {asks.kind === "summary" ? (
        <span
          className="ml-auto font-mono text-[10px] text-muted-foreground"
          data-slot="monitoring-ai-asks"
        >
          {asks.asks} ask{asks.asks === 1 ? "" : "s"} in window
        </span>
      ) : (
        <span className="ml-auto text-[10px] text-muted-foreground">No ask effects in window</span>
      )}
    </div>
  );
}

function formatCost(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  if (value < 0.01) return value.toExponential(2);
  return value.toFixed(4);
}
