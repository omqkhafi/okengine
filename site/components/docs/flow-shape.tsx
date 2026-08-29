/**
 * Flow shape visual — one species, one pipeline.
 *
 * A token travels Trigger → Contracts → do + fx → Effects on a loop, the
 * order a run actually takes. Interactive stage selection with ambient tick,
 * dedicated physics micro-interactions proving each stage's claim, and full
 * reduced-motion compliance.
 */

"use client";

import { motion } from "framer-motion";
import { Globe, RotateCcw, ShieldCheck, Sparkles, Workflow, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

interface StageSpec {
  readonly index: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly icon: LucideIcon;
  readonly code: string;
  readonly body: string;
}

const STAGES: ReadonlyArray<StageSpec> = [
  {
    index: "01",
    title: "Trigger",
    tags: ["http", "clock", "signal", "cdc", "mcp"],
    icon: Globe,
    code: 'on(http.post("/orders"), createOrder)',
    body: "How work starts. Only this piece changes between an endpoint, a job, a consumer, and a row hook.",
  },
  {
    index: "02",
    title: "Contracts",
    tags: ["in", "out", "errors"],
    icon: ShieldCheck,
    code: "in: z.object({ sku: z.string(), qty: z.number() })",
    body: "Validated before and after do. Failures are typed values — returned, never thrown as mystery status text.",
  },
  {
    index: "03",
    title: "do + fx",
    tags: ["do", "fx", "single door"],
    icon: Workflow,
    code: "await fx.store(db).insert(orders).values(input)",
    body: "The body. Every read, write, emit, secret, and model call goes through fx — side-channel I/O is a defect.",
  },
  {
    index: "04",
    title: "Effects",
    tags: ["inferred", "manifest diff"],
    icon: Sparkles,
    code: 'writes: ["sql:orders"] · emits: ["orderPlaced"]',
    body: "Recorded from fx touches. Cache keys, capability tokens, live queries, and Manifest Diff fall out — no hand annotations.",
  },
];

const TICK_MS = 1500;
const tone = CHIP_TONE.sky;
const PACKET = "var(--oke-el-flow)";
const IDLE = "var(--color-fd-muted-foreground)";
const BOX = "var(--color-fd-card)";
const BOX_LINE = "var(--color-fd-border)";
const SPRING = { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.7 };

/**
 * Pipeline diagram of `on(Trigger) → Effects`.
 */
export function FlowShape() {
  const reduced = useClientReducedMotion();
  const tick = useTick(TICK_MS);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Precedence: hovered > selected > ambient tick
  const activeIndex = (() => {
    if (hoveredId !== null) {
      const idx = STAGES.findIndex((s) => s.index === hoveredId);
      if (idx !== -1) return idx;
    }
    if (selectedId !== null) {
      const idx = STAGES.findIndex((s) => s.index === selectedId);
      if (idx !== -1) return idx;
    }
    if (reduced || tick === null) return 0;
    return tick % STAGES.length;
  })();

  const isControlled = selectedId !== null || hoveredId !== null;
  const isLive = !reduced && (!isControlled || hoveredId !== null || selectedId !== null);

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Flow shape: a trigger starts work, contracts validate input and output, the do body touches the world only through fx, and effects are inferred from those touches."
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <div className="flex items-center gap-2">
          <p className="min-w-0 font-mono text-sm font-medium text-fd-foreground">
            on(Trigger) → Effects
          </p>
          {selectedId !== null && (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="inline-flex items-center gap-1 rounded border border-fd-border bg-fd-secondary/60 px-1.5 py-0.5 text-[10px] text-fd-muted-foreground hover:bg-fd-secondary hover:text-fd-foreground transition-colors cursor-pointer"
              title="Resume automatic cycle"
            >
              <RotateCcw className="size-2.5" />
              <span>Resume cycle</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
            one species
          </code>
        </div>
      </div>

      {/* Pipeline step ribbon */}
      <div className="hidden @min-[34rem]:grid grid-cols-4 gap-px border-b border-fd-border bg-fd-border text-center">
        {STAGES.map((s, i) => {
          const isActive = i === activeIndex;
          const isPassed = i < activeIndex;
          return (
            <button
              key={s.index}
              type="button"
              onClick={() => setSelectedId(s.index)}
              onMouseEnter={() => setHoveredId(s.index)}
              onMouseLeave={() => setHoveredId(null)}
              className={cn(
                "flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-mono transition-colors cursor-pointer",
                isActive
                  ? cn(tone.active, "font-medium")
                  : isPassed
                    ? "bg-fd-card text-fd-foreground/80 hover:bg-fd-secondary/50"
                    : "bg-fd-card text-fd-muted-foreground hover:bg-fd-secondary/50",
              )}
            >
              <span className="text-[10px] opacity-60">{s.index}</span>
              <span>{s.title}</span>
            </button>
          );
        })}
      </div>

      <RevealGroup
        as="ol"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[30rem]:grid-cols-2"
      >
        {STAGES.map((stage, i) => {
          const Icon = stage.icon;
          const live = i === activeIndex;
          const passed = i < activeIndex;
          const isSelected = selectedId === stage.index;

          return (
            <RevealItem
              as="li"
              key={stage.index}
              className={cn(
                "group relative flex min-w-0 flex-col gap-2.5 p-4 transition-all duration-300 sm:p-5 cursor-pointer",
                live
                  ? cn(tone.lit, isSelected && "ring-1 ring-fd-border")
                  : passed
                    ? "bg-fd-card hover:bg-fd-secondary/30"
                    : "bg-fd-card hover:bg-fd-secondary/30",
              )}
              onClick={() => setSelectedId((prev) => (prev === stage.index ? null : stage.index))}
              onMouseEnter={() => setHoveredId(stage.index)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono text-[10px] text-fd-muted-foreground/70">
                    {stage.index}
                  </span>
                  <code className="inline-flex items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
                    <Icon
                      className={cn(
                        "size-3 shrink-0 transition-colors duration-200",
                        live
                          ? tone.icon
                          : "text-fd-muted-foreground group-hover:text-fd-foreground",
                      )}
                      aria-hidden
                      strokeWidth={1.75}
                    />
                    {stage.title}
                  </code>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="relative flex size-1.5 shrink-0" aria-hidden>
                    {live && isLive ? (
                      <BeatPing key={`${stage.index}-${tick}`} className={tone.wash} />
                    ) : null}
                    <span
                      className={cn(
                        "size-1.5 rounded-full transition-colors duration-300",
                        live
                          ? tone.hairline
                          : passed
                            ? "bg-fd-muted-foreground/40"
                            : "bg-fd-border",
                      )}
                    />
                  </span>
                </div>
              </div>

              {/* Stage micro-interaction demo */}
              <div className="my-0.5">
                <StageDemo index={stage.index} live={live} />
              </div>

              {/* Tags */}
              <div className="flex flex-wrap items-center gap-1.5">
                {stage.tags.map((tag) => (
                  <code
                    key={tag}
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-200",
                      live
                        ? "border-fd-border bg-fd-card/80 text-fd-foreground font-medium"
                        : "border-fd-border/70 bg-fd-secondary/40 text-fd-muted-foreground",
                    )}
                  >
                    {tag}
                  </code>
                ))}
              </div>

              {/* Code line */}
              <div className="rounded border border-fd-border/70 bg-fd-secondary/30 px-2 py-1 font-mono text-[10px] text-fd-muted-foreground">
                <span className="break-all">{stage.code}</span>
              </div>

              <p className="text-xs leading-relaxed text-pretty text-fd-muted-foreground">
                {stage.body}
              </p>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </figure>
  );
}

/**
 * Renders the dedicated micro-interaction for each stage.
 */
function StageDemo({ index, live }: { readonly index: string; readonly live: boolean }) {
  if (index === "01") return <TriggerDemo live={live} />;
  if (index === "02") return <ContractsDemo live={live} />;
  if (index === "03") return <DoFxDemo live={live} />;
  return <EffectsDemo live={live} />;
}

/** 01 Trigger: External events fan-in into the on() gate */
function TriggerDemo({ live }: { readonly live: boolean }) {
  const triggers = [
    { label: "http", y: 4 },
    { label: "cron", y: 11 },
    { label: "sig", y: 18 },
  ] as const;

  return (
    <div className="flex items-center gap-2" aria-label="trigger fan-in demo">
      <svg viewBox="0 0 84 22" className="h-5 w-21 shrink-0" role="presentation" aria-hidden>
        {triggers.map((t) => (
          <g key={t.label}>
            <circle cx="8" cy={t.y} r="2" fill={IDLE} />
            <line
              x1="12"
              y1={t.y}
              x2="52"
              y2="11"
              stroke={BOX_LINE}
              strokeWidth="1"
              strokeDasharray="2 2"
            />
          </g>
        ))}
        <rect
          x="52"
          y="3"
          width="28"
          height="16"
          rx="2"
          fill={BOX}
          stroke={live ? PACKET : BOX_LINE}
        />
        <text
          x="66"
          y="14"
          textAnchor="middle"
          fill={live ? PACKET : IDLE}
          style={{ fontSize: 6, fontFamily: "ui-monospace, monospace" }}
        >
          on()
        </text>
        <motion.circle
          cy="11"
          r="2.5"
          fill={PACKET}
          initial={false}
          animate={live ? { cx: [14, 52], opacity: [0, 1, 1] } : { cx: 52, opacity: 0.4 }}
          transition={live ? { duration: 0.85, ease: "easeInOut" } : SPRING}
        />
      </svg>
      <code className="text-[10px] font-mono text-fd-muted-foreground/80">
        any trigger → one flow
      </code>
    </div>
  );
}

/** 02 Contracts: Inbound payload is validated before entering do */
function ContractsDemo({ live }: { readonly live: boolean }) {
  return (
    <div className="flex items-center gap-2" aria-label="contract validation demo">
      <svg viewBox="0 0 84 22" className="h-5 w-21 shrink-0" role="presentation" aria-hidden>
        <rect x="4" y="3" width="24" height="16" rx="2" fill={BOX} stroke={BOX_LINE} />
        <text
          x="16"
          y="14"
          textAnchor="middle"
          fill={IDLE}
          style={{ fontSize: 6, fontFamily: "ui-monospace, monospace" }}
        >
          in
        </text>
        <line
          x1="28"
          y1="11"
          x2="56"
          y2="11"
          stroke={BOX_LINE}
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <rect
          x="56"
          y="3"
          width="24"
          height="16"
          rx="2"
          fill={BOX}
          stroke={live ? PACKET : BOX_LINE}
        />
        <text
          x="68"
          y="14"
          textAnchor="middle"
          fill={live ? PACKET : IDLE}
          style={{ fontSize: 6, fontFamily: "ui-monospace, monospace" }}
        >
          ✓ valid
        </text>
        <motion.circle
          cy="11"
          r="2.5"
          fill={PACKET}
          initial={false}
          animate={live ? { cx: [28, 56], opacity: [0, 1, 1] } : { cx: 56, opacity: 0.5 }}
          transition={live ? { duration: 0.85, ease: "easeInOut" } : SPRING}
        />
      </svg>
      <code className="text-[10px] font-mono text-fd-muted-foreground/80">
        typed in/out schemas
      </code>
    </div>
  );
}

/** 03 do + fx: Single door runtime execution */
function DoFxDemo({ live }: { readonly live: boolean }) {
  const handles = [
    { label: "store", y: 4 },
    { label: "emit", y: 11 },
    { label: "vault", y: 18 },
  ] as const;

  return (
    <div className="flex items-center gap-2" aria-label="do fx single door demo">
      <svg viewBox="0 0 84 22" className="h-5 w-21 shrink-0" role="presentation" aria-hidden>
        <rect
          x="4"
          y="3"
          width="22"
          height="16"
          rx="2"
          fill={BOX}
          stroke={live ? PACKET : BOX_LINE}
        />
        <text
          x="15"
          y="14"
          textAnchor="middle"
          fill={live ? PACKET : IDLE}
          style={{ fontSize: 6, fontFamily: "ui-monospace, monospace" }}
        >
          fx
        </text>
        {handles.map((h) => (
          <g key={h.label}>
            <line
              x1="26"
              y1="11"
              x2="60"
              y2={h.y}
              stroke={BOX_LINE}
              strokeWidth="1"
              strokeDasharray="2 2"
            />
            <circle cx="62" cy={h.y} r="2" fill={live ? PACKET : IDLE} />
          </g>
        ))}
        <motion.circle
          r="2.5"
          fill={PACKET}
          initial={false}
          animate={
            live
              ? { cx: [26, 62], cy: [11, 11], opacity: [0, 1, 1] }
              : { cx: 26, cy: 11, opacity: 0.4 }
          }
          transition={live ? { duration: 0.85, ease: "easeInOut" } : SPRING}
        />
      </svg>
      <code className="text-[10px] font-mono text-fd-muted-foreground/80">no side-channel I/O</code>
    </div>
  );
}

/** 04 Effects: Manifest effects inferred automatically */
function EffectsDemo({ live }: { readonly live: boolean }) {
  const tags = [
    { x: 8, w: 20, label: "sql" },
    { x: 32, w: 22, label: "sig" },
    { x: 58, w: 22, label: "sec" },
  ] as const;

  return (
    <div className="flex items-center gap-2" aria-label="inferred effects demo">
      <svg viewBox="0 0 84 22" className="h-5 w-21 shrink-0" role="presentation" aria-hidden>
        {tags.map((t, i) => (
          <g key={t.label}>
            <motion.rect
              x={t.x}
              y="4"
              width={t.w}
              height="14"
              rx="2"
              fill={BOX}
              stroke={live ? PACKET : BOX_LINE}
              initial={false}
              animate={{ opacity: live ? 1 : 0.4 }}
              transition={{ delay: live ? i * 0.1 : 0, duration: 0.3 }}
            />
            <text
              x={t.x + t.w / 2}
              y="14"
              textAnchor="middle"
              fill={live ? PACKET : IDLE}
              style={{ fontSize: 5.5, fontFamily: "ui-monospace, monospace" }}
            >
              {t.label}
            </text>
          </g>
        ))}
      </svg>
      <code className="text-[10px] font-mono text-fd-muted-foreground/80">
        auto-derived manifest
      </code>
    </div>
  );
}
