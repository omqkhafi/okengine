/**
 * One trace row in the scoped Traces list.
 */

import { useState, type MouseEvent } from "react";
import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RunRow } from "@/client.ts";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CacheGlyph } from "./cache-glyph.tsx";
import { formatDuration } from "./format-duration.ts";
import { durationClassName } from "./duration-tone.ts";
import { copyRunIdText } from "./trace-actions.ts";
import { traceRowMeta } from "./trace-row-meta.ts";
import { triggerIconSpec } from "./trigger-icon.ts";

/** Props for {@link TraceRow}. */
export type TraceRowProps = {
  readonly run: RunRow;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
  /** Optional inject for tests — defaults to `navigator.clipboard.writeText`. */
  readonly copyText?: (text: string) => Promise<void>;
};

/**
 * Trace list row — trigger, cache, flow, duration, relative time, copy action.
 *
 * @param props - Run, selection state, click handler
 */
export function TraceRow({
  run,
  selected,
  onSelect,
  copyText = async (text) => {
    await navigator.clipboard.writeText(text);
  },
}: TraceRowProps) {
  const meta = traceRowMeta(run);
  const failed = meta.failed;
  const trigger = triggerIconSpec(run.trigger);
  const cache = run.cache;
  const [actionHint, setActionHint] = useState<string | null>(null);

  const onCopy = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await copyText(copyRunIdText(run));
      setActionHint("Copied run id");
    } catch {
      setActionHint("Copy failed");
    }
  };

  return (
    <div
      data-slot="trace-row"
      data-run-id={run.id}
      data-selected={selected ? "true" : "false"}
      data-failed={failed ? "true" : "false"}
      data-cache={run.cache}
      className={cn(
        "group relative flex w-full items-stretch border-b border-border/60 text-xs transition-colors",
        "hover:bg-muted/50 focus-within:bg-muted/50",
        selected && "bg-muted/70",
        failed && "bg-destructive/[0.04]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-0.5",
          selected && !failed && "bg-sky-500",
          failed && "bg-destructive",
        )}
      />
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(run.id)}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 pl-0 text-left outline-none"
      >
        <span
          className={cn(
            "ml-2.5 size-1.5 shrink-0 rounded-full",
            failed ? "bg-destructive" : "bg-emerald-500",
          )}
          aria-hidden
        />
        <span className="shrink-0 text-muted-foreground" title={trigger.label} aria-hidden>
          <HugeiconsIcon icon={trigger.icon} className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{run.flow}</span>
        <CacheGlyph cache={cache} dataSlot="trace-row-cache" />
        <span
          className={cn(
            "w-10 shrink-0 text-right tabular-nums font-medium",
            durationClassName(run.durationMs),
          )}
        >
          {formatDuration(run.durationMs)}
        </span>
        <span
          className="w-14 shrink-0 truncate text-right tabular-nums text-muted-foreground"
          title={meta.title}
          data-slot="trace-row-meta"
        >
          {meta.text}
        </span>
      </button>
      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5 pr-1.5 opacity-0 transition-opacity",
          "group-hover:opacity-100 group-focus-within:opacity-100",
          actionHint && "opacity-100",
        )}
      >
        <Tooltip>
          <TooltipTrigger
            render={(props) => (
              <Button
                {...props}
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Copy run ID"
                data-slot="trace-copy-id"
                onClick={(event) => {
                  props.onClick?.(event);
                  void onCopy(event);
                }}
              >
                <HugeiconsIcon icon={Copy01Icon} className="size-3" />
              </Button>
            )}
          />
          <TooltipContent side="top">Copy run ID</TooltipContent>
        </Tooltip>
      </div>
      {actionHint ? (
        <span className="sr-only" role="status">
          {actionHint}
        </span>
      ) : null}
    </div>
  );
}
