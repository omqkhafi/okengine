/**
 * One trace row in the scoped Traces list.
 */

import type { RunRow } from "@/client.ts";
import { cn } from "@/lib/utils";

function relativeTime(startedAt: number): string {
  const delta = Date.now() - startedAt;
  if (delta < 1_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1_000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

function duration(durationMs: number): string {
  if (durationMs < 1) return "<1ms";
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1_000).toFixed(2)}s`;
}

/**
 * Trace list row — flow, duration, status, timestamp.
 *
 * @param props - Run, selection state, click handler
 */
export function TraceRow({
  run,
  selected,
  onSelect,
}: {
  readonly run: RunRow;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}) {
  const failed = run.error !== null;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(run.id)}
      className={cn(
        "flex w-full items-center gap-3 border-b px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60",
        selected && "bg-muted",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          failed ? "bg-destructive" : "bg-emerald-500",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{run.flow}</span>
      <span className="shrink-0 text-muted-foreground">{duration(run.durationMs)}</span>
      <span className="w-20 shrink-0 truncate text-right text-muted-foreground">
        {failed ? (run.error ?? "error") : relativeTime(run.startedAt)}
      </span>
    </button>
  );
}
