/**
 * Trace detail Sheet — waterfall, event list, and request input snapshot.
 */

import { useEffect, useMemo, useState, type JSX, type MouseEvent } from "react";
import {
  ApiIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowReloadHorizontalIcon,
  ArrowRight01Icon,
  LeftToRightListBulletIcon,
  MinusSignIcon,
  PlusSignIcon,
  Timer01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { tracesReplay, type RunRow } from "@/client.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils";
import { useManifest } from "../data/use-manifest.ts";
import { NODE_ACCENT } from "../graph/flow-graph-theme.ts";
import {
  effectBarColor,
  effectKindIcon,
  type RunEffectKind,
} from "./effect-kind.ts";
import {
  effectEventLabel,
  effectSummaryChips,
  type EffectSummaryChip,
  type EffectSummaryVariant,
} from "./effect-summary.ts";
import { formatDuration } from "./format-duration.ts";
import { durationClassName } from "./duration-tone.ts";
import { traceRequestMeta } from "./request-meta.ts";
import { TraceRequestSection } from "./trace-request-section.tsx";
import { executeTraceReplay } from "./trace-actions.ts";
import { traceGateInfos, type TraceGateInfo } from "./trace-gates.ts";
import { triggerIconSpec } from "./trigger-icon.ts";
import { waterfallBars, type WaterfallBar } from "./waterfall-bars.ts";
import {
  mapToViewport,
  timelineTicksForView,
  timelineView,
  waterfallGaps,
  zoomInStep,
  zoomOutStep,
  type TimelineView,
  type WaterfallGap,
} from "./waterfall-timeline.ts";
import { waterfallBarTooltip } from "./waterfall-tooltip.ts";

/** Props for {@link TraceDetailSheet}. */
export type TraceDetailSheetProps = {
  /** Selected run, or `null` when the Sheet is closed. */
  readonly run: RunRow | null;
  /** Clear selection / close the Sheet. */
  readonly onClose: () => void;
  /** Optional inject for tests — defaults to {@link tracesReplay}. */
  readonly replay?: typeof tracesReplay;
};

const sectionClassName = "flex flex-col gap-2.5 border-b border-border/60 px-3 py-3 last:border-b-0";

/** Bordered control button style for the sheet chrome. */
const sheetControlButtonClass =
  "border border-border bg-background shadow-none hover:bg-muted";

/**
 * Right-side Sheet opened by selecting a Traces row.
 *
 * Additive to graph highlight — selection still drives the Flow graph.
 *
 * @param props - Selected run + close handler
 */
export function TraceDetailSheet({
  run,
  onClose,
  replay = tracesReplay,
}: TraceDetailSheetProps) {
  const manifest = useManifest();
  const trigger = run ? triggerIconSpec(run.trigger) : null;
  const chips = useMemo(() => (run ? effectSummaryChips(run) : []), [run]);
  const gateInfos = useMemo(
    () => (run ? traceGateInfos(run.gates, manifest.data ?? null) : []),
    [run, manifest.data],
  );
  const bars = useMemo(
    () => (run ? waterfallBars(run.effects, run.startedAt, run.durationMs) : []),
    [run],
  );
  const gaps = useMemo(
    () => (run ? waterfallGaps(bars, run.durationMs) : []),
    [run, bars],
  );
  const requestMeta = useMemo(
    () =>
      run
        ? traceRequestMeta(manifest.data ?? null, run.flow, run.trigger)
        : { method: null, path: null, headline: "" },
    [run, manifest.data],
  );

  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [hintTone, setHintTone] = useState<"ok" | "error" | null>(null);
  const [eventsOpen, setEventsOpen] = useState(true);
  const [inputOpen, setInputOpen] = useState(true);
  const [outputOpen, setOutputOpen] = useState(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);

  const view = useMemo(() => timelineView(zoom, viewStart), [zoom, viewStart]);
  const ticks = useMemo(
    () => (run ? timelineTicksForView(run.durationMs, view) : []),
    [run, view],
  );

  useEffect(() => {
    setHint(null);
    setHintTone(null);
    setBusy(false);
    setEventsOpen(true);
    setInputOpen(true);
    setOutputOpen(true);
    setHoverIndex(null);
    setZoom(1);
    setViewStart(0);
  }, [run?.id]);

  const onReplay = async (e: MouseEvent) => {
    e.stopPropagation();
    if (!run || busy) return;
    setBusy(true);
    setHint(null);
    setHintTone(null);
    try {
      const res = await executeTraceReplay(run, replay);
      if (res.error) {
        setHint(res.error.message ?? res.error.code);
        setHintTone("error");
        return;
      }
      setHint(res.data?.dryRun ? "Replayed (dry-run)" : "Replayed");
      setHintTone("ok");
    } catch (err) {
      setHint(err instanceof Error ? err.message : "Replay failed");
      setHintTone("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={run !== null}
      modal={false}
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        showOverlay={false}
        data-slot="trace-detail-sheet"
        className="inset-y-0 right-0 h-dvh w-full max-w-none gap-0 rounded-none p-0 shadow-xl data-[side=right]:sm:max-w-xl"
      >
        {run && trigger ? (
          <>
            <SheetHeader className="gap-2 border-b border-border px-3 py-3 pr-12">
              <div className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-foreground shadow-sm"
                  title={trigger.label}
                  aria-hidden
                >
                  <HugeiconsIcon icon={trigger.icon} className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate font-mono text-base font-semibold tracking-tight">
                    {run.flow}
                  </SheetTitle>
                  <SheetDescription className="mt-0.5 text-[11px] text-muted-foreground">
                    {trigger.label}
                  </SheetDescription>
                </div>
              </div>
              {hint ? (
                <Badge
                  variant="outline"
                  role="status"
                  className={cn(
                    "h-5 w-fit rounded-md px-1.5 text-[10px] font-medium",
                    hintTone === "ok" &&
                      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                    hintTone === "error" &&
                      "border-destructive/40 bg-destructive/10 text-destructive",
                  )}
                >
                  {hint}
                </Badge>
              ) : null}
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto p-0">
              <section className={sectionClassName} data-slot="trace-summary">
                <TraceSummaryStrip chips={chips} durationMs={run.durationMs} />
              </section>

              {gateInfos.length > 0 ? (
                <section className={sectionClassName} data-slot="trace-gates">
                  <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Gates
                  </h3>
                  <ul className="flex flex-col gap-1" data-slot="trace-gates-list">
                    {gateInfos.map((gate) => (
                      <GateRow key={gate.name} gate={gate} />
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className={sectionClassName} data-slot="trace-waterfall">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Waterfall
                  </h3>
                  <div
                    className="flex items-center gap-0.5"
                    data-slot="trace-waterfall-zoom"
                  >
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-xs"
                      className={sheetControlButtonClass}
                      aria-label="Pan left"
                      disabled={zoom <= 1 || view.startRatio <= 0}
                      onClick={() =>
                        setViewStart((s) =>
                          timelineView(zoom, Math.max(0, s - view.widthRatio * 0.5)).startRatio,
                        )
                      }
                    >
                      <HugeiconsIcon icon={ArrowLeft01Icon} />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-xs"
                      className={sheetControlButtonClass}
                      aria-label="Zoom out"
                      disabled={zoom <= 1}
                      onClick={() => {
                        const next = zoomOutStep(zoom);
                        setZoom(next);
                        setViewStart((s) => timelineView(next, s).startRatio);
                      }}
                    >
                      <HugeiconsIcon icon={MinusSignIcon} />
                    </Button>
                    <span className="min-w-8 text-center font-mono text-[10px] tabular-nums text-muted-foreground">
                      {zoom}×
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-xs"
                      className={sheetControlButtonClass}
                      aria-label="Zoom in"
                      disabled={zoom >= 8}
                      onClick={() => {
                        const next = zoomInStep(zoom);
                        setZoom(next);
                        setViewStart((s) => timelineView(next, s).startRatio);
                      }}
                    >
                      <HugeiconsIcon icon={PlusSignIcon} />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-xs"
                      className={sheetControlButtonClass}
                      aria-label="Pan right"
                      disabled={zoom <= 1 || view.startRatio + view.widthRatio >= 1}
                      onClick={() =>
                        setViewStart((s) =>
                          timelineView(zoom, s + view.widthRatio * 0.5).startRatio,
                        )
                      }
                    >
                      <HugeiconsIcon icon={ArrowRight01Icon} />
                    </Button>
                  </div>
                </div>
                {bars.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No effects recorded</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <TimelineRuler ticks={ticks} />
                    <OverviewTrack
                      bars={bars}
                      gaps={gaps}
                      view={view}
                      hoverIndex={hoverIndex}
                      onHover={setHoverIndex}
                    />
                    {bars.map((bar) => (
                      <WaterfallBarRow
                        key={bar.index}
                        bar={bar}
                        view={view}
                        dimmed={hoverIndex !== null && hoverIndex !== bar.index}
                        onHover={setHoverIndex}
                      />
                    ))}
                    {gaps.length > 0 ? (
                      <p className="text-[10px] text-muted-foreground">
                        Hatched spans are idle time — no effects recorded.
                      </p>
                    ) : null}
                  </div>
                )}
              </section>

              <section className={sectionClassName} data-slot="trace-events-section">
                <Collapsible open={eventsOpen} onOpenChange={setEventsOpen}>
                  <div className="flex items-center gap-2">
                    <CollapsibleTrigger
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-foreground"
                      data-slot="trace-events-toggle"
                    >
                      <HugeiconsIcon
                        icon={ArrowDown01Icon}
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground transition-transform",
                          !eventsOpen && "-rotate-90",
                        )}
                      />
                      <span className="truncate">
                        Event Details ({run.effects.length}{" "}
                        {run.effects.length === 1 ? "event" : "events"})
                      </span>
                    </CollapsibleTrigger>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className={cn("shrink-0", sheetControlButtonClass)}
                      disabled={busy}
                      data-slot="trace-sheet-replay"
                      onClick={(event) => void onReplay(event)}
                    >
                      <HugeiconsIcon icon={ArrowReloadHorizontalIcon} data-icon="inline-start" />
                      Replay
                    </Button>
                  </div>
                  <CollapsibleContent className="pt-2">
                    <ul className="flex flex-col gap-1" data-slot="trace-events">
                      {run.effects.map((effect, index) => {
                        const bar = bars[index];
                        return (
                          <li
                            key={`${effect.kind}:${effect.resource}:${index}`}
                            data-slot="trace-event-row"
                            data-index={index}
                            className={cn(
                              "flex flex-col gap-1 rounded-md px-1.5 py-1.5 text-[11px] transition-colors",
                              hoverIndex === index ? "bg-muted" : "hover:bg-muted/60",
                            )}
                            onMouseEnter={() => setHoverIndex(index)}
                            onMouseLeave={() => setHoverIndex(null)}
                          >
                            <div className="flex items-center gap-2">
                              <EffectKindGlyph kind={effect.kind} />
                              <span className="w-[4.5rem] shrink-0 font-medium text-foreground/90">
                                {effectEventLabel(effect)}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                                {effect.resource}
                              </span>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {formatDuration(effect.duration)}
                              </span>
                            </div>
                            {bar ? (
                              <div
                                className="relative ml-7 h-1.5 w-[calc(100%-1.75rem)] rounded-full bg-muted/70"
                                data-slot="trace-event-bar-track"
                                aria-hidden
                              >
                                <div
                                  className="absolute inset-y-0 rounded-full"
                                  style={{
                                    left: `${bar.offsetRatio * 100}%`,
                                    width: `${Math.max(bar.widthRatio * 100, bar.widthRatio > 0 ? 0.5 : 0)}%`,
                                    backgroundColor: effectBarColor(bar.kind),
                                  }}
                                  data-slot="trace-event-bar"
                                />
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              </section>

              <TraceRequestSection
                method={requestMeta.method}
                path={requestMeta.path}
                headline={requestMeta.headline}
                input={run.input}
                output={run.output}
                error={run.error}
                errorMessage={run.errorMessage}
                inputOpen={inputOpen}
                onInputOpenChange={setInputOpen}
                outputOpen={outputOpen}
                onOutputOpenChange={setOutputOpen}
              />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Colored element glyph shared by event rows and summary chips.
 *
 * @param props - Effect kind
 */
function EffectKindGlyph({ kind }: { readonly kind: RunEffectKind }): JSX.Element {
  const color = effectBarColor(kind);
  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center rounded-md border"
      style={{
        color,
        background: `color-mix(in oklab, ${color} 16%, transparent)`,
        borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
      }}
      aria-hidden
    >
      <HugeiconsIcon icon={effectKindIcon(kind)} className="size-3" />
    </span>
  );
}

/**
 * Duration-led telemetry strip — hero time + compact metric chips.
 *
 * @param props - Summary chips + duration for tone
 */
function TraceSummaryStrip({
  chips,
  durationMs,
}: {
  readonly chips: readonly EffectSummaryChip[];
  readonly durationMs: number;
}): JSX.Element {
  const duration = chips.find((c) => c.variant === "duration");
  const metrics = chips.filter((c) => c.variant !== "duration");
  return (
    <div
      className="flex items-center gap-3"
      data-slot="trace-summary-strip"
      role="group"
      aria-label="Run summary"
    >
      {duration ? (
        <Tooltip>
          <TooltipTrigger
            render={(props) => (
              <div
                {...props}
                className="flex shrink-0 items-center gap-1.5"
                data-slot="trace-summary-duration"
              >
                <HugeiconsIcon
                  icon={Timer01Icon}
                  className={cn("size-3.5", durationClassName(durationMs))}
                  aria-hidden
                />
                <span
                  className={cn(
                    "font-mono text-xl font-semibold tracking-tight tabular-nums leading-none",
                    durationClassName(durationMs),
                  )}
                >
                  {duration.label}
                </span>
              </div>
            )}
          />
          <TooltipContent side="bottom" className="max-w-xs text-[11px]">
            {duration.detail}
          </TooltipContent>
        </Tooltip>
      ) : null}

      {metrics.length > 0 ? (
        <>
          <div className="h-7 w-px shrink-0 bg-border/60" aria-hidden />
          <ul className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {metrics.map((chip) => (
              <li key={chip.key} className="list-none shrink-0">
                <SummaryChip chip={chip} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/**
 * Compact metric chip — icon + short label; full label + source in tooltip.
 *
 * @param props - Chip descriptor
 */
function SummaryChip({ chip }: { readonly chip: EffectSummaryChip }): JSX.Element {
  const color = summaryAccent(chip.variant);
  const icon = summaryIcon(chip.variant);
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span
            {...props}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border/50 bg-muted/30 px-1.5 text-[11px] text-foreground/90 transition-colors hover:bg-muted/55"
            data-slot="trace-summary-chip"
            data-variant={chip.variant}
          >
            <span style={{ color }} aria-hidden>
              <HugeiconsIcon icon={icon} className="size-3" />
            </span>
            <span className="tabular-nums font-medium">{chip.shortLabel}</span>
            <span className="sr-only">{chip.label}</span>
          </span>
        )}
      />
      <TooltipContent side="bottom" className="max-w-xs flex-col items-start gap-0.5 text-[11px]">
        <p className="font-medium text-background">{chip.label}</p>
        <p className="text-background/70">{chip.detail}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Gate element accent — distinct from store / signal / AI graph tokens. */
const GATE_ACCENT = "#A78BFA";

/**
 * One Gate row — name + Manifest kind/description when declared.
 *
 * @param props - Resolved gate info
 */
function GateRow({ gate }: { readonly gate: TraceGateInfo }): JSX.Element {
  const meta = [gate.kind, gate.description].filter(Boolean).join(" · ");
  return (
    <li
      className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[11px] hover:bg-muted/60"
      data-slot="trace-gate-row"
    >
      <span
        className="flex size-5 shrink-0 items-center justify-center"
        style={{ color: GATE_ACCENT }}
        aria-hidden
      >
        <HugeiconsIcon icon={ELEMENT_ICONS.gate.icon} className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate font-mono font-medium text-foreground/90">
        {gate.name}
      </span>
      {meta ? (
        <span className="min-w-0 max-w-[55%] truncate text-muted-foreground">{meta}</span>
      ) : (
        <span className="shrink-0 text-muted-foreground">undeclared</span>
      )}
    </li>
  );
}

function summaryIcon(variant: EffectSummaryVariant) {
  switch (variant) {
    case "duration":
      return Timer01Icon;
    case "api":
      return ApiIcon;
    case "gate":
      return ELEMENT_ICONS.gate.icon;
    case "db":
      return ELEMENT_ICONS.store.icon;
    case "logs":
      return LeftToRightListBulletIcon;
    default:
      return effectKindIcon(variant);
  }
}

function summaryAccent(variant: EffectSummaryVariant): string {
  switch (variant) {
    case "duration":
      return "currentColor";
    case "api":
      return "var(--foreground)";
    case "gate":
      return GATE_ACCENT;
    case "db":
      return NODE_ACCENT.store.accent;
    case "logs":
      return "var(--muted-foreground)";
    default:
      return effectBarColor(variant);
  }
}

/**
 * Time ruler above the waterfall tracks.
 *
 * @param props - Viewport ticks
 */
function TimelineRuler({
  ticks,
}: {
  readonly ticks: ReturnType<typeof timelineTicksForView>;
}): JSX.Element {
  return (
    <div
      className="relative h-4 w-full border-b border-border/50"
      data-slot="trace-waterfall-ruler"
    >
      {ticks.map((tick) => (
        <div
          key={`${tick.offsetMs}-${tick.viewRatio}`}
          className="absolute top-0 flex h-full flex-col items-center"
          style={{
            left: `${tick.viewRatio * 100}%`,
            transform: tick.isEnd
              ? "translateX(-100%)"
              : tick.viewRatio === 0
                ? "none"
                : "translateX(-50%)",
          }}
        >
          <span className="font-mono text-[9px] tabular-nums text-muted-foreground">
            {formatDuration(tick.offsetMs)}
          </span>
          <span className="mt-auto h-1.5 w-px bg-border" aria-hidden />
        </div>
      ))}
    </div>
  );
}

/**
 * Single overview lane — all effects + idle gaps on one track (reference pattern).
 *
 * @param props - Bars, gaps, viewport, hover sync
 */
function OverviewTrack({
  bars,
  gaps,
  view,
  hoverIndex,
  onHover,
}: {
  readonly bars: readonly WaterfallBar[];
  readonly gaps: readonly WaterfallGap[];
  readonly view: TimelineView;
  readonly hoverIndex: number | null;
  readonly onHover: (index: number | null) => void;
}): JSX.Element {
  return (
    <div
      className="relative h-3 w-full overflow-hidden rounded-full bg-muted/50"
      data-slot="trace-waterfall-overview"
    >
      {gaps.map((gap) => {
        const mapped = mapToViewport(gap.offsetRatio, gap.widthRatio, view);
        if (!mapped || mapped.width <= 0) return null;
        return (
          <GapSegment
            key={`gap-${gap.startOffsetMs}`}
            left={mapped.left}
            width={mapped.width}
            gap={gap}
          />
        );
      })}
      {bars.map((bar) => {
        const mapped = mapToViewport(bar.offsetRatio, bar.widthRatio, view);
        if (!mapped || mapped.width <= 0) return null;
        return (
          <Tooltip key={`ov-${bar.index}`}>
            <TooltipTrigger
              render={(props) => (
                <div
                  {...props}
                  className={cn(
                    "absolute inset-y-0.5 rounded-full transition-opacity",
                    hoverIndex !== null && hoverIndex !== bar.index && "opacity-35",
                  )}
                  style={{
                    left: `${mapped.left * 100}%`,
                    width: `${Math.max(mapped.width * 100, 0.4)}%`,
                    backgroundColor: effectBarColor(bar.kind),
                  }}
                  data-slot="trace-waterfall-overview-bar"
                  onMouseEnter={(event) => {
                    props.onMouseEnter?.(event);
                    onHover(bar.index);
                  }}
                  onMouseLeave={(event) => {
                    props.onMouseLeave?.(event);
                    onHover(null);
                  }}
                />
              )}
            />
            <TooltipContent side="top" className="max-w-xs font-mono text-[11px]">
              {waterfallBarTooltip(bar)}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * Hatched idle gap with an explicit Idle tooltip.
 *
 * @param props - Viewport position + gap timing
 */
function GapSegment({
  left,
  width,
  gap,
}: {
  readonly left: number;
  readonly width: number;
  readonly gap: WaterfallGap;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <div
            {...props}
            className="absolute inset-y-0 overflow-hidden rounded-sm"
            style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
            data-slot="trace-waterfall-gap"
          >
            <div
              className="size-full opacity-70"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(-45deg, color-mix(in oklab, var(--muted-foreground) 28%, transparent) 0 1px, transparent 1px 5px)",
              }}
              aria-hidden
            />
          </div>
        )}
      />
      <TooltipContent side="top" className="max-w-xs text-[11px]">
        Idle · {formatDuration(gap.durationMs)} — no effects recorded
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * One waterfall track with a real tooltip (viewport-aware).
 *
 * @param props - Bar layout + hover sync + zoom view
 */
function WaterfallBarRow({
  bar,
  view,
  dimmed,
  onHover,
}: {
  readonly bar: WaterfallBar;
  readonly view: TimelineView;
  readonly dimmed: boolean;
  readonly onHover: (index: number | null) => void;
}): JSX.Element | null {
  const mapped = mapToViewport(bar.offsetRatio, bar.widthRatio, view);
  if (!mapped || mapped.width <= 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <div
            {...props}
            className="relative h-2.5 w-full cursor-default rounded-full bg-muted/70"
            data-slot="trace-waterfall-track"
            data-index={bar.index}
            onMouseEnter={(event) => {
              props.onMouseEnter?.(event);
              onHover(bar.index);
            }}
            onMouseLeave={(event) => {
              props.onMouseLeave?.(event);
              onHover(null);
            }}
          >
            <div
              className={cn(
                "absolute inset-y-0 rounded-full transition-opacity",
                dimmed && "opacity-35",
              )}
              style={{
                left: `${mapped.left * 100}%`,
                width: `${Math.max(mapped.width * 100, 0.5)}%`,
                backgroundColor: effectBarColor(bar.kind),
              }}
              data-slot="trace-waterfall-bar"
            />
          </div>
        )}
      />
      <TooltipContent side="top" className="max-w-xs font-mono text-[11px]">
        {waterfallBarTooltip(bar)}
      </TooltipContent>
    </Tooltip>
  );
}

