/**
 * Store physics demos — claims that tables alone under-teach.
 *
 * - StoreKvTtl: redis honors TTL (key expires) vs memory ignores it (key stays)
 * - StoreFilesVariants: putImage fans into original + named variant keys + LQIP
 * - StoreIndexModes: vector ANN vs meilisearch FTS — discriminated union on driverId
 *
 * Same quality bar as SignalDelivery / FlowTriggers: ambient tick phases, BeatPing,
 * reduced motion holds the end state. Deterministic — never Math.random.
 */

"use client";

import { motion } from "framer-motion";
import { Binary, FileImage, Search, Timer, type LucideIcon } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const tone = CHIP_TONE.teal;
const PACKET = "var(--oke-el-store)";
const IDLE = "var(--color-fd-muted-foreground)";
const BOX = "var(--color-fd-card)";
const BOX_LINE = "var(--color-fd-border)";

const TICK_MS = 1000;

function PhaseChip({
  label,
  live,
  tick,
}: {
  readonly label: string;
  readonly live: boolean;
  readonly tick: number | null;
}) {
  return (
    <div className="flex items-center gap-2">
      <code
        className={cn(
          "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-300",
          live ? tone.active : "border-fd-border text-fd-muted-foreground",
        )}
      >
        {label}
      </code>
      <span className="relative flex size-1.5 shrink-0" aria-hidden>
        {live && tick !== null ? <BeatPing key={tick} className={tone.wash} /> : null}
        <span
          className={cn(
            "size-1.5 rounded-full transition-colors duration-300",
            live ? tone.hairline : "bg-fd-border",
          )}
        />
      </span>
    </div>
  );
}

/* ─── KV TTL contrast ─────────────────────────────────────────────────── */

const KV_PHASES = ["set", "ttl", "ttl", "expire"] as const;

/**
 * redis honors TTL — memory ignores it. Same `set(…, "30m")`, opposite physics.
 */
export function StoreKvTtl() {
  const tick = useTick(TICK_MS);
  const phase = tick === null ? -1 : tick % KV_PHASES.length;
  const label = phase < 0 ? "set" : KV_PHASES[phase];
  // redis lit segments: set=3 → 2 → 1 → 0; memory always full
  const redisLit = phase < 0 ? 2 : phase === 0 ? 3 : phase === 1 ? 2 : phase === 2 ? 1 : 0;
  const redisKeyOn = phase >= 0 && phase < 3;
  const memoryKeyOn = true;
  const memoryLit = 3;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="KV TTL physics: redis drains the TTL and expires the key; memory ignores TTL and the key stays."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">TTL — same call, different physics</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          set(key, value, &quot;30m&quot;)
        </code>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-fd-border px-4 py-2 sm:px-5">
        <PhaseChip label={label} live={phase >= 0} tick={tick} />
        <span className="text-[11px] text-fd-muted-foreground">
          shared beat across both drivers
        </span>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-2"
      >
        <RevealItem
          as="li"
          lift
          className="flex min-w-0 flex-col gap-2 bg-fd-card px-4 py-4 sm:px-5"
        >
          <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
            <Timer className={cn("size-3", tone.icon)} aria-hidden strokeWidth={1.75} />
            redis
          </code>
          <TtlSlot keyOn={redisKeyOn} lit={redisLit} />
          <p className="text-xs font-medium text-fd-foreground">TTL honored</p>
          <p className="text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
            `SET … EX` — the key vanishes when the bar hits zero. No sweeper Flow required.
          </p>
        </RevealItem>
        <RevealItem
          as="li"
          lift
          className="flex min-w-0 flex-col gap-2 bg-fd-card px-4 py-4 sm:px-5"
        >
          <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
            <Binary className={cn("size-3", tone.icon)} aria-hidden strokeWidth={1.75} />
            memory
          </code>
          <TtlSlot keyOn={memoryKeyOn} lit={memoryLit} />
          <p className="text-xs font-medium text-fd-foreground">TTL ignored</p>
          <p className="text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
            Local default — the key stays until `delete` or process exit. Test expiry on redis.
          </p>
        </RevealItem>
      </RevealGroup>
    </figure>
  );
}

function TtlSlot({ keyOn, lit }: { readonly keyOn: boolean; readonly lit: number }) {
  return (
    <svg viewBox="0 0 84 22" className="h-5 w-21" role="presentation" aria-hidden>
      <rect x="4" y="2" width="76" height="12" rx="2" fill={BOX} stroke={BOX_LINE} />
      <motion.rect
        x="10"
        y="5"
        width="36"
        height="6"
        rx="1"
        fill={PACKET}
        initial={false}
        animate={{ opacity: keyOn ? 0.95 : 0.12 }}
        transition={{ duration: 0.3 }}
      />
      <motion.rect
        x="50"
        y="6"
        width="22"
        height="4"
        rx="1"
        fill={IDLE}
        initial={false}
        animate={{ opacity: keyOn ? 0.45 : 0.08 }}
        transition={{ duration: 0.3 }}
      />
      {[0, 1, 2].map((i) => (
        <motion.rect
          key={i}
          x={8 + i * 24}
          y="17"
          width="20"
          height="3"
          rx="1"
          fill={PACKET}
          initial={false}
          animate={{ opacity: i < lit ? 0.9 : 0.15 }}
          transition={{ duration: 0.3 }}
        />
      ))}
    </svg>
  );
}

/* ─── Files putImage variants ─────────────────────────────────────────── */

const VARIANT_PHASES = ["put", "original", "thumb", "medium", "lqip"] as const;
const OBJECT_KEYS = [
  { id: "original", key: "photos/x.jpg", w: 34 },
  { id: "thumb", key: "photos/x.thumb.webp", w: 28 },
  { id: "medium", key: "photos/x.medium.webp", w: 30 },
] as const;

/**
 * putImage writes the original, then named variants — keys are stem.variant.ext.
 * Optional placeholder is a returned LQIP string, not a fourth stored object.
 */
export function StoreFilesVariants() {
  const tick = useTick(900);
  const phase = tick === null ? -1 : tick % VARIANT_PHASES.length;
  const label = phase < 0 ? "put" : VARIANT_PHASES[phase];
  // Object sinks lit: put=0, original=1, thumb=2, medium=3; lqip lights the chip only
  const lit = phase <= 0 ? 0 : Math.min(phase, OBJECT_KEYS.length);
  const lqipOn = phase === 4;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="putImage fans one upload into the original object plus named variant keys; optional placeholder returns a ThumbHash data URL, not another object."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">putImage — one write, many keys</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          {"{stem}.{variant}.{ext}"}
        </code>
      </div>

      <RevealGroup as="div" className="flex flex-col gap-3 bg-fd-card px-4 py-4 sm:px-5">
        <RevealItem as="div" className="flex flex-wrap items-center gap-2">
          <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
            <FileImage className={cn("size-3", tone.icon)} aria-hidden strokeWidth={1.75} />
            putImage
          </code>
          <PhaseChip label={label} live={phase >= 0} tick={tick} />
        </RevealItem>

        <RevealItem as="div">
          <svg
            viewBox="0 0 200 44"
            className="h-12 w-full max-w-md"
            role="presentation"
            aria-hidden
          >
            <circle cx="14" cy="22" r="4" fill={IDLE} />
            <line
              x1="20"
              y1="22"
              x2="48"
              y2="22"
              stroke={BOX_LINE}
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <motion.circle
              cy="22"
              r="3"
              fill={PACKET}
              initial={false}
              animate={{
                cx: phase >= 0 ? 48 : 14,
                opacity: phase >= 0 ? 1 : 0.35,
              }}
              transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.7 }}
            />
            {OBJECT_KEYS.map((v, i) => {
              const y = 6 + i * 14;
              const on = i < lit;
              return (
                <g key={v.id}>
                  <line
                    x1="48"
                    y1="22"
                    x2="64"
                    y2={y}
                    stroke={BOX_LINE}
                    strokeWidth="1"
                    strokeDasharray="2 3"
                  />
                  <motion.rect
                    x="64"
                    y={y - 4}
                    width={v.w * 3.2}
                    height="8"
                    rx="2"
                    fill={BOX}
                    stroke={BOX_LINE}
                    initial={false}
                    animate={{ opacity: on ? 1 : 0.45 }}
                    transition={{ duration: 0.3 }}
                  />
                  <motion.rect
                    x="68"
                    y={y - 2}
                    width={v.w * 2.6}
                    height="4"
                    rx="1"
                    fill={PACKET}
                    initial={false}
                    animate={{ opacity: on ? 0.95 : 0.12 }}
                    transition={{ duration: 0.3 }}
                  />
                </g>
              );
            })}
          </svg>
        </RevealItem>

        <RevealItem as="ul" className="grid grid-cols-1 gap-1 @min-[28rem]:grid-cols-2">
          {OBJECT_KEYS.map((v, i) => (
            <li key={v.id}>
              <code
                className={cn(
                  "block truncate rounded border px-2 py-1 font-mono text-[10px] transition-colors duration-300",
                  i < lit ? tone.active : "border-fd-border text-fd-muted-foreground",
                )}
              >
                {v.key}
              </code>
            </li>
          ))}
          <li>
            <code
              className={cn(
                "block truncate rounded border px-2 py-1 font-mono text-[10px] transition-colors duration-300",
                lqipOn ? tone.active : "border-fd-border text-fd-muted-foreground",
              )}
            >
              result.placeholder → data:image/…
            </code>
          </li>
        </RevealItem>

        <RevealItem
          as="div"
          className="text-[11px] leading-relaxed text-pretty text-fd-muted-foreground"
        >
          Original stays at the source key; each variant is{" "}
          <code className="font-mono text-[10px]">{"{stem}.{variant}.{ext}"}</code>. Optional{" "}
          <code className="font-mono text-[10px]">placeholder: true</code> returns a ThumbHash LQIP
          data URL — not a fourth object.
        </RevealItem>
      </RevealGroup>
    </figure>
  );
}

/* ─── Index vector vs text ────────────────────────────────────────────── */

const INDEX_MODES: ReadonlyArray<{
  readonly id: "vector" | "text";
  readonly label: string;
  readonly icon: LucideIcon;
  readonly drivers: string;
  readonly upsert: string;
  readonly search: string;
  readonly score: string;
  readonly useFor: string;
}> = [
  {
    id: "vector",
    label: "vector",
    icon: Binary,
    drivers: "memory · pgvector · libsql",
    upsert: "upsert(id, vector, meta?)",
    search: "search(vector, topK?)",
    score: "cosine similarity",
    useFor: "Embeddings — ai.embed / fx.search",
  },
  {
    id: "text",
    label: "meilisearch",
    icon: Search,
    drivers: "meilisearch (opt-in)",
    upsert: "upsert(id, document)",
    search: "search(q, { topK, filter, facets })",
    score: "relevance (_rankingScore)",
    useFor: "Typo-tolerant full-text + facets",
  },
];

/**
 * One store.index declaration — two incompatible search physics, split by driverId.
 */
export function StoreIndexModes() {
  const tick = useTick(1100);
  const active = tick === null ? -1 : tick % INDEX_MODES.length;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Index modes: vector drivers take embedding vectors and return cosine scores; meilisearch takes a text query and returns relevance scores. TypeScript keeps the two apart."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">
          store.index — pick the search physics
        </p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          discriminated on driverId
        </code>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-2"
      >
        {INDEX_MODES.map((mode, i) => {
          const Icon = mode.icon;
          const live = i === active;
          return (
            <RevealItem
              as="li"
              lift
              key={mode.id}
              className={cn(
                "flex min-w-0 flex-col gap-2 px-4 py-4 transition-colors duration-300 sm:px-5",
                live ? tone.lit : "bg-fd-card",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
                  <Icon className={cn("size-3", tone.icon)} aria-hidden strokeWidth={1.75} />
                  {mode.label}
                </code>
                <span className="relative flex size-1.5 shrink-0" aria-hidden>
                  {live && tick !== null ? <BeatPing key={tick} className={tone.wash} /> : null}
                  <span
                    className={cn(
                      "size-1.5 rounded-full transition-colors duration-300",
                      live ? tone.hairline : "bg-fd-border",
                    )}
                  />
                </span>
              </div>
              {mode.id === "vector" ? <VectorModeDemo live={live} /> : <TextModeDemo live={live} />}
              <code className="font-mono text-[10px] text-fd-muted-foreground">{mode.drivers}</code>
              <p className="font-mono text-[10px] text-fd-foreground">{mode.upsert}</p>
              <p className="font-mono text-[10px] text-fd-foreground">{mode.search}</p>
              <p className="text-xs text-pretty text-fd-muted-foreground">score → {mode.score}</p>
              <p className="mt-auto text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
                {mode.useFor}
              </p>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </figure>
  );
}

function VectorModeDemo({ live }: { readonly live: boolean }) {
  const hits = [
    { y: 5, w: 26 },
    { y: 12, w: 18 },
    { y: 19, w: 12 },
  ] as const;
  return (
    <svg viewBox="0 0 84 25" className="h-6 w-21" role="presentation" aria-hidden>
      <circle cx="8" cy="12" r="2.5" fill={IDLE} />
      <line
        x1="12"
        y1="12"
        x2="34"
        y2="12"
        stroke={BOX_LINE}
        strokeWidth="1"
        strokeDasharray="2 3"
      />
      <motion.circle
        cy="12"
        r="2"
        fill={PACKET}
        initial={false}
        animate={{ cx: live ? 34 : 8, opacity: live ? 1 : 0.35 }}
        transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.7 }}
      />
      {hits.map((hit, i) => (
        <g key={hit.y}>
          <line
            x1="34"
            y1="12"
            x2="42"
            y2={hit.y}
            stroke={BOX_LINE}
            strokeWidth="1"
            strokeDasharray="2 3"
          />
          <motion.rect
            x="42"
            y={hit.y - 2}
            width={hit.w}
            height="4"
            rx="1"
            fill={PACKET}
            initial={false}
            animate={{ opacity: live ? 0.95 - i * 0.18 : 0.12 }}
            transition={{ duration: 0.35, delay: live ? i * 0.06 : 0 }}
          />
        </g>
      ))}
    </svg>
  );
}

function TextModeDemo({ live }: { readonly live: boolean }) {
  const rows = ["invoice draft", "invoice paid", "guide · billing"] as const;
  return (
    <div className="flex flex-col gap-1" aria-hidden>
      <code
        className={cn(
          "w-fit rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-300",
          live ? tone.active : "border-fd-border text-fd-muted-foreground",
        )}
      >
        q=&quot;invoice&quot;
      </code>
      {rows.map((row, i) => (
        <motion.code
          key={row}
          className={cn(
            "truncate rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-300",
            live && i === 0 ? tone.active : "border-fd-border text-fd-muted-foreground",
          )}
          initial={false}
          animate={{ opacity: live ? 1 - i * 0.12 : 0.25 }}
          transition={{ duration: 0.35, delay: live ? i * 0.08 : 0 }}
        >
          {row}
        </motion.code>
      ))}
    </div>
  );
}
