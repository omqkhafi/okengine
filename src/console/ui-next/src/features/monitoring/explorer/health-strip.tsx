/**
 * System health strip — status dots + lookback, real sources only.
 */

import { Link } from "@tanstack/react-router";
import type { JSX } from "react";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { cn } from "@/lib/utils.ts";
import type { HealthCell } from "../lib/health-cells.ts";
import { MONITORING_WINDOWS, type MonitoringWindow } from "../lib/window-stats.ts";

/** Props for {@link HealthStrip}. */
export interface HealthStripProps {
  readonly cells: readonly HealthCell[];
  readonly window: MonitoringWindow;
  readonly onWindowChange: (window: MonitoringWindow) => void;
  /** Open the fleet Sheet (Instances chip). */
  readonly onInstancesClick?: () => void;
}

const WINDOW_ORDER = Object.keys(MONITORING_WINDOWS) as MonitoringWindow[];

/**
 * Compact status chips + window tokens under the page chrome.
 *
 * @param props - Projected cells + window control
 */
export function HealthStrip({
  cells,
  window,
  onWindowChange,
  onInstancesClick,
}: HealthStripProps): JSX.Element {
  return (
    <section
      aria-label="System health"
      className="shrink-0 border-b border-border/60 bg-background"
      data-slot="monitoring-health-strip"
    >
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        {cells.map((cell) => (
          <HealthChip
            key={cell.id}
            cell={cell}
            onClick={cell.id === "instances" ? onInstancesClick : undefined}
          />
        ))}
        <div
          className="ml-auto flex flex-wrap items-center gap-0.5 rounded-md bg-muted/40 p-0.5"
          role="group"
          aria-label="Lookback window"
        >
          {WINDOW_ORDER.map((token) => {
            const pressed = token === window;
            return (
              <ToolbarTip key={token} label={`Last ${token}`}>
                <button
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => onWindowChange(token)}
                  className={cn(
                    "inline-flex items-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                    pressed
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {token}
                </button>
              </ToolbarTip>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function HealthChip({
  cell,
  onClick,
}: {
  readonly cell: HealthCell;
  readonly onClick?: () => void;
}): JSX.Element {
  const className = cn(
    "inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[10px] transition-colors",
    cell.tone === "warn" && "text-destructive dark:text-rose-300",
    cell.tone === "ok" && "text-foreground/85",
    cell.tone === "empty" && "text-muted-foreground",
    onClick || cell.href ? "hover:bg-muted/50" : null,
  );
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          cell.tone === "ok" && "bg-emerald-500 dark:bg-emerald-400",
          cell.tone === "warn" && "bg-destructive",
          cell.tone === "empty" && "bg-muted-foreground/40",
          cell.id === "live" && cell.tone === "ok" && "animate-pulse",
        )}
      />
      <span className="font-medium">{cell.label}</span>
      <span className="font-mono tabular-nums">{cell.value}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        data-slot={`health-cell-${cell.id}`}
        data-tone={cell.tone}
        className={className}
        aria-label={`${cell.label} ${cell.value}`}
        onClick={onClick}
      >
        {body}
      </button>
    );
  }
  if (cell.href) {
    return (
      <Link
        to={cell.href}
        data-slot={`health-cell-${cell.id}`}
        data-tone={cell.tone}
        className={className}
        aria-label={`${cell.label} ${cell.value}`}
      >
        {body}
      </Link>
    );
  }
  return (
    <span
      role={cell.tone === "warn" ? "alert" : "status"}
      data-slot={`health-cell-${cell.id}`}
      data-tone={cell.tone}
      className={className}
    >
      {body}
    </span>
  );
}
