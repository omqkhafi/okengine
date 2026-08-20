/**
 * Trace detail Sheet — waterfall, event list, and request input snapshot.
 */

import { useEffect, useMemo, useState, type JSX, type MouseEvent } from "react";
import {
  ApiIcon,
  FlashIcon,
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
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "@/lib/motion";
import {
  EXPLORER_CHEVRON_CLASS,
  EXPLORER_COUNT_CLASS,
  EXPLORER_ICON_BUTTON_CLASS,
  EXPLORER_ICON_CLASS,
  EXPLORER_RAIL_ACTIVE_CLASS,
  EXPLORER_RAIL_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_ROW_SELECTED_CLASS,
  EXPLORER_STRIP_CLASS,
  EXPLORER_STRIP_TOKEN_CLASS,
  SECTION_HEAD_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GateList } from "@/components/gate-list";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils";
import { useManifest } from "../data/use-manifest.ts";
import { NODE_ACCENT } from "../graph/flow-graph-theme.ts";
import { effectBarColor, effectKindIcon, type RunEffectKind } from "./effect-kind.ts";
import {
  effectEventLabel,
  effectSummaryChips,
  type EffectSummaryChip,
  type EffectSummaryVariant,
} from "./effect-summary.ts";
import { cacheIconSpec } from "./cache-icon.ts";
import { formatDuration } from "./format-duration.ts";
import { durationClassName } from "./duration-tone.ts";
import { traceRequestMeta } from "./request-meta.ts";
import { TraceRequestSection } from "./trace-request-section.tsx";
import { executeTraceReplay } from "./trace-actions.ts";
import { traceGateInfos } from "./trace-gates.ts";
import { triggerIconSpec } from "./trigger-icon.ts";
import { playbackDurationMs } from "./replay-playback.ts";
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
  /** Sticky focused effect index (synced with the graph). */
  readonly focusEffectIndex?: number | null;
  /** Set sticky focus when a bar / event row is clicked. */
  readonly onFocusEffectChange?: (index: number | null) => void;
  /** Bumped by the page to retrigger playback for the same run. */
  readonly playbackKey?: number;
  /** Called when Replay succeeds so the page can pulse the graph chain. */
  readonly onReplayStart?: () => void;
};

const sectionClassName = "border-b border-border/60 last:border-b-0";

/**
 * Start-side Sheet opened by selecting a Traces row.
 *
 * Additive to graph highlight — selection still drives the Flow graph.
 *
 * @param props - Selected run + close handler
 */
export function TraceDetailSheet({
  run,
  onClose,
  replay = tracesReplay,
  focusEffectIndex = null,
  onFocusEffectChange,
  playbackKey = 0,
  onReplayStart,
}: TraceDetailSheetProps) {
  const manifest = useManifest();
  const reduceMotion = useReducedMotion();
  const trigger = run ? triggerIconSpec(run.trigger) : null;
  const cache = run ? cacheIconSpec(run.cache) : null;
  const chips = useMemo(() => (run ? effectSummaryChips(run) : []), [run]);
  const gateInfos = useMemo(
    () => (run ? traceGateInfos(run.gates, manifest.data ?? null) : []),
    [run, manifest.data],
  );
  const bars = useMemo(
    () => (run ? waterfallBars(run.effects, run.startedAt, run.durationMs) : []),
    [run],
  );
  const gaps = useMemo(() => (run ? waterfallGaps(bars, run.durationMs) : []), [run, bars]);
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
  const [playing, setPlaying] = useState(false);

  const progress = useMotionValue(0);
  // Hero duration counter — counts up on open, tracks the playhead on Replay.
  const durationMv = useMotionValue(0);

  const view = useMemo(() => timelineView(zoom, viewStart), [zoom, viewStart]);
  const ticks = useMemo(() => (run ? timelineTicksForView(run.durationMs, view) : []), [run, view]);

  // Playhead tracks the zoomed viewport; parks offscreen when out of view.
  const playheadLeft = useTransform(progress, (p) => {
    const mapped = mapToViewport(p, 0.0001, view);
    return mapped ? `${mapped.left * 100}%` : "-10%";
  });

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
    setPlaying(false);
    progress.set(0);
    if (!run) return;
    if (reduceMotion) {
      durationMv.set(run.durationMs);
      return;
    }
    durationMv.set(0);
    const controls = animate(durationMv, run.durationMs, {
      duration: 0.6,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
    // Count-up runs once per selected run — not on live-poll identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, reduceMotion]);

  // Drive the waterfall playhead when the page bumps playbackKey (Replay).
  useEffect(() => {
    if (playbackKey === 0 || !run) return;
    if (reduceMotion) {
      progress.set(1);
      durationMv.set(run.durationMs);
      setPlaying(false);
      return;
    }
    setPlaying(true);
    progress.set(0);
    durationMv.set(0);
    const controls = animate(progress, 1, {
      duration: playbackDurationMs(run.durationMs) / 1000,
      ease: "linear",
      onUpdate: (p) => durationMv.set(p * run.durationMs),
      onComplete: () => {
        durationMv.set(run.durationMs);
        setPlaying(false);
      },
    });
    return () => {
      controls.stop();
      setPlaying(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackKey]);

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
      onReplayStart?.();
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
        side="left"
        showOverlay={false}
        data-slot="trace-detail-sheet"
        className="inset-y-0 h-dvh w-full max-w-none gap-0 rounded-none p-0 shadow-xl md:left-12! data-[side=left]:sm:max-w-2xl"
        // left-12 = icon rail (3rem). Important beats SheetContent's left-0;
        // the portal is outside the wrapper that defines --sidebar-width-icon.
      >
        {run && trigger ? (
          <>
            <SheetHeader className="gap-1.5 border-b border-border/60 px-2 py-2 pr-12">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-muted-foreground" title={trigger.label} aria-hidden>
                  <HugeiconsIcon icon={trigger.icon} className={EXPLORER_ICON_CLASS} />
                </span>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate font-mono text-base font-semibold tracking-tight">
                    {run.flow}
                  </SheetTitle>
                  <SheetDescription className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{trigger.label}</span>
                    {cache ? (
                      <>
                        <span aria-hidden>·</span>
                        <span
                          className={cn("inline-flex items-center gap-1", cache.className)}
                          data-slot="trace-sheet-cache"
                          data-cache={run.cache}
                          title={cache.label}
                        >
                          <HugeiconsIcon icon={cache.icon} className="size-3" aria-hidden />
                          {cache.label}
                        </span>
                      </>
                    ) : null}
                  </SheetDescription>
                </div>
              </div>
              <AnimatePresence mode="wait">
                {hint ? (
                  <motion.div
                    key={hint}
                    initial={reduceMotion ? false : { opacity: 0, y: -4, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={reduceMotion ? undefined : { opacity: 0, y: -4, scale: 0.96 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                  >
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
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto p-0">
              <section className={sectionClassName} data-slot="trace-summary">
                <TraceSummaryStrip
                  chips={chips}
                  durationMs={run.durationMs}
                  durationValue={durationMv}
                />
              </section>

              {gateInfos.length > 0 ? (
                <section className={sectionClassName} data-slot="trace-gates">
                  <GateList gates={gateInfos} />
                </section>
              ) : null}

              <section className={sectionClassName} data-slot="trace-waterfall">
                <div className={EXPLORER_STRIP_CLASS}>
                  <h3 className={cn(SECTION_HEAD_CLASS, "flex items-center px-2")}>Waterfall</h3>
                  <div
                    className="ml-auto flex h-full items-stretch"
                    data-slot="trace-waterfall-zoom"
                  >
                    <button
                      type="button"
                      className={EXPLORER_ICON_BUTTON_CLASS}
                      aria-label="Pan left"
                      disabled={zoom <= 1 || view.startRatio <= 0}
                      onClick={() =>
                        setViewStart(
                          (s) =>
                            timelineView(zoom, Math.max(0, s - view.widthRatio * 0.5)).startRatio,
                        )
                      }
                    >
                      <HugeiconsIcon icon={ArrowLeft01Icon} className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className={EXPLORER_ICON_BUTTON_CLASS}
                      aria-label="Zoom out"
                      disabled={zoom <= 1}
                      onClick={() => {
                        const next = zoomOutStep(zoom);
                        setZoom(next);
                        setViewStart((s) => timelineView(next, s).startRatio);
                      }}
                    >
                      <HugeiconsIcon icon={MinusSignIcon} className="size-3.5" />
                    </button>
                    <span className="flex min-w-8 items-center justify-center font-mono text-[10px] tabular-nums text-muted-foreground">
                      {zoom}×
                    </span>
                    <button
                      type="button"
                      className={EXPLORER_ICON_BUTTON_CLASS}
                      aria-label="Zoom in"
                      disabled={zoom >= 8}
                      onClick={() => {
                        const next = zoomInStep(zoom);
                        setZoom(next);
                        setViewStart((s) => timelineView(next, s).startRatio);
                      }}
                    >
                      <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className={EXPLORER_ICON_BUTTON_CLASS}
                      aria-label="Pan right"
                      disabled={zoom <= 1 || view.startRatio + view.widthRatio >= 1}
                      onClick={() =>
                        setViewStart(
                          (s) => timelineView(zoom, s + view.widthRatio * 0.5).startRatio,
                        )
                      }
                    >
                      <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" />
                    </button>
                  </div>
                </div>
                {bars.length === 0 ? (
                  <p className="px-2 py-2 text-[11px] text-muted-foreground">No effects recorded</p>
                ) : (
                  <div className="relative flex flex-col gap-1.5 px-2 py-2">
                    <TimelineRuler ticks={ticks} />
                    <OverviewTrack
                      bars={bars}
                      gaps={gaps}
                      view={view}
                      hoverIndex={hoverIndex}
                      onHover={setHoverIndex}
                      onSelect={(index) =>
                        onFocusEffectChange?.(focusEffectIndex === index ? null : index)
                      }
                      focusIndex={focusEffectIndex}
                    />
                    {bars.map((bar) => (
                      <WaterfallBarRow
                        key={bar.index}
                        bar={bar}
                        view={view}
                        dimmed={hoverIndex !== null && hoverIndex !== bar.index}
                        focused={focusEffectIndex === bar.index}
                        progress={progress}
                        playing={playing}
                        onHover={setHoverIndex}
                        onSelect={(index) =>
                          onFocusEffectChange?.(focusEffectIndex === index ? null : index)
                        }
                      />
                    ))}
                    {playing ? (
                      <motion.div
                        className="pointer-events-none absolute top-4 bottom-0 w-px bg-foreground/70"
                        style={{ left: playheadLeft }}
                        data-slot="trace-waterfall-playhead"
                        aria-hidden
                      />
                    ) : null}
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
                  <div className={EXPLORER_STRIP_CLASS}>
                    <CollapsibleTrigger
                      className={cn(EXPLORER_STRIP_TOKEN_CLASS, "min-w-0 flex-1 justify-start")}
                      data-slot="trace-events-toggle"
                    >
                      <HugeiconsIcon
                        icon={ArrowDown01Icon}
                        className={cn(EXPLORER_CHEVRON_CLASS, !eventsOpen && "-rotate-90")}
                      />
                      <span className="truncate">Event Details</span>
                      <span className={EXPLORER_COUNT_CLASS}>
                        {run.effects.length} {run.effects.length === 1 ? "event" : "events"}
                      </span>
                    </CollapsibleTrigger>
                    <button
                      type="button"
                      className={EXPLORER_STRIP_TOKEN_CLASS}
                      disabled={busy}
                      data-slot="trace-sheet-replay"
                      onClick={(event) => void onReplay(event)}
                    >
                      <HugeiconsIcon icon={ArrowReloadHorizontalIcon} className="size-3.5" />
                      Replay
                    </button>
                  </div>
                  <CollapsibleContent>
                    <ul className="flex flex-col" data-slot="trace-events">
                      {run.effects.map((effect, index) => {
                        const bar = bars[index];
                        const focused = focusEffectIndex === index;
                        return (
                          <li
                            key={`${effect.kind}:${effect.resource}:${index}`}
                            data-slot="trace-event-row"
                            data-index={index}
                            data-focused={focused ? "true" : "false"}
                            className={cn(
                              EXPLORER_ROW_CLASS,
                              "cursor-pointer flex-col items-stretch gap-1 text-[11px]",
                              focused && EXPLORER_ROW_SELECTED_CLASS,
                              hoverIndex === index && !focused && "bg-muted/50",
                            )}
                            onClick={() =>
                              onFocusEffectChange?.(focusEffectIndex === index ? null : index)
                            }
                            onMouseEnter={() => setHoverIndex(index)}
                            onMouseLeave={() => setHoverIndex(null)}
                          >
                            <span
                              aria-hidden
                              className={cn(
                                EXPLORER_RAIL_CLASS,
                                focused && EXPLORER_RAIL_ACTIVE_CLASS,
                              )}
                            />
                            <div className="flex items-center gap-2">
                              <EffectKindGlyph kind={effect.kind} resource={effect.resource} />
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
                                <PlaybackBarFill
                                  bar={bar}
                                  left={bar.offsetRatio}
                                  width={bar.widthRatio}
                                  progress={progress}
                                  playing={playing}
                                  slot="trace-event-bar"
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
function EffectKindGlyph({
  kind,
  resource,
}: {
  readonly kind: RunEffectKind;
  readonly resource?: string;
}): JSX.Element {
  const color = effectBarColor(kind);
  return (
    <span className={EXPLORER_ICON_CLASS} style={{ color }} aria-hidden>
      <HugeiconsIcon icon={effectKindIcon(kind, resource)} className="size-3.5" />
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
  durationValue,
}: {
  readonly chips: readonly EffectSummaryChip[];
  readonly durationMs: number;
  /** Animated duration in ms — counts up on open, tracks Replay playback. */
  readonly durationValue: MotionValue<number>;
}): JSX.Element {
  const duration = chips.find((c) => c.variant === "duration");
  const metrics = chips.filter((c) => c.variant !== "duration");
  const label = useTransform(durationValue, (v) => formatDuration(Math.round(v)));
  return (
    <div
      className={EXPLORER_STRIP_CLASS}
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
                className="flex h-full shrink-0 items-center gap-1.5 px-2"
                data-slot="trace-summary-duration"
              >
                <HugeiconsIcon
                  icon={Timer01Icon}
                  className={cn("size-3.5", durationClassName(durationMs))}
                  aria-hidden
                />
                <motion.span
                  className={cn(
                    "font-mono text-sm font-semibold tracking-tight tabular-nums leading-none",
                    durationClassName(durationMs),
                  )}
                >
                  {label}
                </motion.span>
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
          <span className="w-px shrink-0 self-stretch bg-border/60" aria-hidden />
          <ul className="flex h-full min-w-0 flex-1 flex-nowrap items-stretch overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
            className={cn(EXPLORER_STRIP_TOKEN_CLASS, "text-foreground/90")}
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

function summaryIcon(variant: EffectSummaryVariant) {
  switch (variant) {
    case "duration":
      return Timer01Icon;
    case "api":
      return ApiIcon;
    case "gate":
      return ELEMENT_ICONS.gate.icon;
    case "cache":
      return FlashIcon;
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
      return NODE_ACCENT.gate.accent;
    case "cache":
      return "var(--color-sky-500)";
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
      className="relative h-4 w-full border-b border-border/60"
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
  onSelect,
  focusIndex,
}: {
  readonly bars: readonly WaterfallBar[];
  readonly gaps: readonly WaterfallGap[];
  readonly view: TimelineView;
  readonly hoverIndex: number | null;
  readonly onHover: (index: number | null) => void;
  readonly onSelect?: (index: number) => void;
  readonly focusIndex?: number | null;
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
        const focused = focusIndex === bar.index;
        return (
          <Tooltip key={`ov-${bar.index}`}>
            <TooltipTrigger
              render={(props) => (
                <div
                  {...props}
                  className={cn(
                    "absolute inset-y-0.5 cursor-pointer rounded-full transition-opacity",
                    hoverIndex !== null && hoverIndex !== bar.index && !focused && "opacity-35",
                    focused && "ring-1 ring-foreground/40",
                  )}
                  style={{
                    left: `${mapped.left * 100}%`,
                    width: `${Math.max(mapped.width * 100, 0.4)}%`,
                    backgroundColor: effectBarColor(bar.kind),
                  }}
                  data-slot="trace-waterfall-overview-bar"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect?.(bar.index);
                  }}
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
  focused,
  progress,
  playing,
  onHover,
  onSelect,
}: {
  readonly bar: WaterfallBar;
  readonly view: TimelineView;
  readonly dimmed: boolean;
  readonly focused?: boolean;
  readonly progress: MotionValue<number>;
  readonly playing: boolean;
  readonly onHover: (index: number | null) => void;
  readonly onSelect?: (index: number) => void;
}): JSX.Element | null {
  const mapped = mapToViewport(bar.offsetRatio, bar.widthRatio, view);
  if (!mapped || mapped.width <= 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <div
            {...props}
            className="relative h-2.5 w-full cursor-pointer rounded-full bg-muted/70"
            data-slot="trace-waterfall-track"
            data-index={bar.index}
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(bar.index);
            }}
            onMouseEnter={(event) => {
              props.onMouseEnter?.(event);
              onHover(bar.index);
            }}
            onMouseLeave={(event) => {
              props.onMouseLeave?.(event);
              onHover(null);
            }}
          >
            <PlaybackBarFill
              bar={bar}
              left={mapped.left}
              width={mapped.width}
              progress={progress}
              playing={playing}
              dimmed={dimmed}
              focused={focused}
              slot="trace-waterfall-bar"
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

/**
 * Waterfall / event bar fill. Static at rest; during Replay playback the fill
 * grows from its left edge as the playhead crosses the bar's run-time span.
 */
function PlaybackBarFill({
  bar,
  left,
  width,
  progress,
  playing,
  dimmed = false,
  focused = false,
  slot,
}: {
  readonly bar: WaterfallBar;
  /** Display left edge as a `[0, 1]` fraction of the track. */
  readonly left: number;
  /** Display width as a `[0, 1]` fraction of the track. */
  readonly width: number;
  readonly progress: MotionValue<number>;
  readonly playing: boolean;
  readonly dimmed?: boolean;
  readonly focused?: boolean;
  readonly slot: string;
}): JSX.Element {
  // Grow across the bar's own run-time span (epsilon floor for instant effects).
  const span = Math.max(bar.widthRatio, 0.02);
  const scaleX = useTransform(progress, [bar.offsetRatio, bar.offsetRatio + span], [0, 1], {
    clamp: true,
  });
  const opacity = useTransform(progress, (p) => (p >= bar.offsetRatio ? 1 : 0.25));
  const animated = playing;
  return (
    <motion.div
      className={cn(
        "absolute inset-y-0 rounded-full transition-opacity",
        !animated && dimmed && !focused && "opacity-35",
        focused && "ring-1 ring-foreground/40",
      )}
      style={{
        left: `${left * 100}%`,
        width: `${Math.max(width * 100, 0.5)}%`,
        backgroundColor: effectBarColor(bar.kind),
        transformOrigin: "left",
        ...(animated ? { scaleX, opacity } : {}),
      }}
      data-slot={slot}
    />
  );
}
