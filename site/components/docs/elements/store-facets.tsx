/**
 * Four store facets — sql / kv / files / index, one fx.store handle per facet.
 *
 * Same quality bar as FlowTriggers / SignalDelivery: each card (and each
 * section mark) runs an ambient physics demo that proves what the facet does —
 * a SQL op cycle, a KV TTL expire, a Files put→get, an Index search fan-out.
 * Deterministic from one tick / SVG loops; never Math.random. Reduced motion
 * holds the delivered end state.
 */

"use client";

import { MotionConfig, motion } from "framer-motion";
import { Braces, Database, FolderOpen, Search, type LucideIcon } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

const tone = CHIP_TONE.teal;

type FacetId = "sql" | "kv" | "files" | "index";

const FACETS: ReadonlyArray<{
  readonly id: FacetId;
  readonly icon: LucideIcon;
  readonly declare: string;
  readonly kind: string;
  readonly physics: string;
  readonly forData: string;
}> = [
  {
    id: "sql",
    icon: Database,
    declare: "store.sql(name, opts)",
    kind: "Relational tables",
    physics: "Single-table session — ops cycle through one row",
    forData: "Domain tables, relations, constraints",
  },
  {
    id: "kv",
    icon: Braces,
    declare: "store.kv(name)",
    kind: "Key-value space",
    physics: "set → TTL drains → key expires",
    forData: "Cache, sessions, rate limits",
  },
  {
    id: "files",
    icon: FolderOpen,
    declare: "store.files(name)",
    kind: "Blob bucket",
    physics: "put into the bucket, get the bytes back",
    forData: "Uploads, exports, attachments, image variants",
  },
  {
    id: "index",
    icon: Search,
    declare: "store.index(name, opts)",
    kind: "Search index",
    physics: "search fans out — hits ranked by score",
    forData: "Vector (dims) or full-text",
  },
];

/** Packet / accent ink — Store's soft element var as SVG presentation attrs. */
const PACKET = "var(--oke-el-store)";
const IDLE = "var(--color-fd-muted-foreground)";
const BOX = "var(--color-fd-card)";
const BOX_LINE = "var(--color-fd-border)";

const SQL_OPS = ["select", "insert", "update", "findById"] as const;
const TICK_MS = 1200;

/**
 * One declaration style, four storage physics — drivers swap per environment.
 */
export function StoreFacets() {
  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Four store facets — SQL tables, key-value cache, file blobs, and search index — behind one fx.store handle, drivers swapped per environment."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Four facets, one handle</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          fx.store(db)…
        </code>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-2"
      >
        {FACETS.map((f) => {
          const Icon = f.icon;
          return (
            <RevealItem
              as="li"
              lift
              key={f.id}
              className="flex min-w-0 flex-col gap-2 bg-fd-card px-4 py-4 transition-colors hover:bg-fd-secondary/40 sm:px-5"
            >
              <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
                <Icon className={cn("size-3", tone.icon)} aria-hidden strokeWidth={1.75} />
                {f.id}
              </code>
              <FacetDemo kind={f.id} />
              <p className="text-xs font-medium text-fd-foreground">{f.kind}</p>
              <code className="max-w-full font-mono text-[11px] break-all text-fd-muted-foreground">
                {f.declare}
              </code>
              <p className="text-xs text-pretty text-fd-muted-foreground">{f.physics}</p>
              <p className="mt-auto text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
                {f.forData}
              </p>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </figure>
  );
}

/**
 * Compact teaching strip for a facet section — same ambient physics as the
 * overview card, sized for the band under ## SQL / KV / Files / Index.
 *
 * @param facet - Which store facet section this mark belongs to
 */
export function StoreFacetMark({ facet }: { readonly facet: FacetId }) {
  const reduced = useClientReducedMotion();
  const f = FACETS.find((row) => row.id === facet);
  if (!f) return null;
  const Icon = f.icon;

  return (
    <MotionConfig reducedMotion="never">
      <motion.figure
        aria-label={`${f.id} facet — ${f.physics}`}
        className="not-prose my-3 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
        initial={reduced ? false : { opacity: 0, y: 8 }}
        whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-6% 0px" }}
        transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.7 }}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-fd-border px-3 py-2 sm:px-4">
          <code className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-fd-foreground">
            <Icon className={cn("size-3", tone.icon)} aria-hidden strokeWidth={1.75} />
            {f.id}
            <span className="font-normal text-fd-muted-foreground">· {f.kind}</span>
          </code>
          <code className="hidden font-mono text-[10px] text-fd-muted-foreground sm:inline">
            {f.declare}
          </code>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 sm:px-4">
          <FacetDemo kind={f.id} />
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
            {f.physics}
          </p>
        </div>
      </motion.figure>
    </MotionConfig>
  );
}

/**
 * Ambient physics strip — distinct motion per facet (SignalDelivery pattern).
 *
 * @param kind - Which facet to demo
 */
function FacetDemo({ kind }: { readonly kind: FacetId }) {
  if (kind === "sql") return <SqlDemo />;
  if (kind === "kv") return <KvDemo />;
  if (kind === "files") return <FilesDemo />;
  return <IndexDemo />;
}

/** SQL — ops cycle through one row; active verb + BeatPing. */
function SqlDemo() {
  const tick = useTick(TICK_MS);
  const reduced = useClientReducedMotion();
  const active = tick === null ? -1 : tick % SQL_OPS.length;
  const op = active < 0 ? "select" : SQL_OPS[active];

  return (
    <div className="flex flex-col gap-1.5" aria-label="sql session demo">
      <div className="flex items-center gap-2">
        <code
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-300",
            active >= 0 ? tone.active : "border-fd-border text-fd-muted-foreground",
          )}
        >
          {op}
        </code>
        <span className="relative flex size-1.5 shrink-0" aria-hidden>
          {active >= 0 && tick !== null ? <BeatPing key={tick} className={tone.wash} /> : null}
          <span
            className={cn(
              "size-1.5 rounded-full transition-colors duration-300",
              active >= 0 ? tone.hairline : "bg-fd-border",
            )}
          />
        </span>
      </div>
      <svg viewBox="0 0 84 22" className="h-5 w-21" role="presentation" aria-hidden>
        <rect x="4" y="3" width="76" height="16" rx="2" fill={BOX} stroke={BOX_LINE} />
        {[14, 34, 54, 74].map((x, i) => (
          <motion.rect
            key={x}
            x={x - 6}
            y="6"
            width="12"
            height="10"
            rx="1.5"
            fill={PACKET}
            initial={false}
            animate={
              reduced
                ? { opacity: i === 0 ? 0.85 : 0.25 }
                : { opacity: active === i || (op === "select" && active === 0) ? 0.95 : 0.22 }
            }
            transition={{ duration: 0.35 }}
          />
        ))}
      </svg>
    </div>
  );
}

const KV_PHASES = ["set", "ttl", "ttl", "expire"] as const;
const FILES_PHASES = ["put", "put", "get", "get"] as const;

/** KV — set a key, TTL segments drain, key expires (tick phases — no SVG width anim). */
function KvDemo() {
  const tick = useTick(900);
  const phase = tick === null ? -1 : tick % KV_PHASES.length;
  const label = phase < 0 ? "set" : KV_PHASES[phase];
  // Segments lit: set=3, first ttl=2, second ttl=1, expire=0
  const lit = phase < 0 ? 2 : phase === 0 ? 3 : phase === 1 ? 2 : phase === 2 ? 1 : 0;
  const keyOn = phase >= 0 && phase < 3;

  return (
    <div className="flex flex-col gap-1.5" aria-label="kv ttl expire demo">
      <div className="flex items-center gap-2">
        <code
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-300",
            phase >= 0 ? tone.active : "border-fd-border text-fd-muted-foreground",
          )}
        >
          {label}
        </code>
        <span className="relative flex size-1.5 shrink-0" aria-hidden>
          {phase >= 0 && tick !== null ? <BeatPing key={tick} className={tone.wash} /> : null}
          <span
            className={cn(
              "size-1.5 rounded-full transition-colors duration-300",
              phase >= 0 ? tone.hairline : "bg-fd-border",
            )}
          />
        </span>
      </div>
      <svg viewBox="0 0 84 22" className="h-5 w-21" role="presentation" aria-hidden>
        <rect x="4" y="2" width="56" height="12" rx="2" fill={BOX} stroke={BOX_LINE} />
        <motion.rect
          x="10"
          y="5"
          width="28"
          height="6"
          rx="1"
          fill={PACKET}
          initial={false}
          animate={{ opacity: keyOn ? 0.95 : 0.12 }}
          transition={{ duration: 0.3 }}
        />
        <motion.rect
          x="42"
          y="6"
          width="12"
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
            x={8 + i * 16}
            y="17"
            width="14"
            height="3"
            rx="1"
            fill={PACKET}
            initial={false}
            animate={{ opacity: i < lit ? 0.9 : 0.15 }}
            transition={{ duration: 0.3 }}
          />
        ))}
      </svg>
    </div>
  );
}

/** Files — put into the bucket, then get bytes back (tick phases). */
function FilesDemo() {
  const tick = useTick(1000);
  const phase = tick === null ? -1 : tick % FILES_PHASES.length;
  const label = phase < 0 ? "put" : FILES_PHASES[phase];
  const emit = 10;
  const sink = 70;
  const y = 11;
  // 0: at emit (putting), 1: in bucket, 2: in bucket (getting), 3: back at emit
  const cx = phase <= 0 || phase === 3 ? emit : sink;
  const inBucket = phase === 1 || phase === 2;

  return (
    <div className="flex flex-col gap-1.5" aria-label="files put get demo">
      <div className="flex items-center gap-2">
        <code
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-300",
            phase >= 0 ? tone.active : "border-fd-border text-fd-muted-foreground",
          )}
        >
          {label}
        </code>
        <span className="relative flex size-1.5 shrink-0" aria-hidden>
          {phase >= 0 && tick !== null ? <BeatPing key={tick} className={tone.wash} /> : null}
          <span
            className={cn(
              "size-1.5 rounded-full transition-colors duration-300",
              phase >= 0 ? tone.hairline : "bg-fd-border",
            )}
          />
        </span>
      </div>
      <svg viewBox="0 0 84 22" className="h-5 w-21" role="presentation" aria-hidden>
        <line
          x1={emit}
          y1={y}
          x2={sink}
          y2={y}
          stroke={BOX_LINE}
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        <circle cx={emit} cy={y} r="2.5" fill={IDLE} />
        <motion.rect
          x={sink - 6}
          y={y - 7}
          width="14"
          height="14"
          rx="2"
          fill={BOX}
          stroke={BOX_LINE}
          initial={false}
          animate={{ opacity: inBucket ? 1 : 0.85 }}
          transition={{ duration: 0.3 }}
        />
        <motion.circle
          cy={y}
          r="2.5"
          fill={PACKET}
          initial={false}
          animate={{ cx, opacity: phase < 0 ? 0.5 : 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.7 }}
        />
      </svg>
    </div>
  );
}

/** Index — query probe, then hits light in score order (tick phases). */
function IndexDemo() {
  const tick = useTick(850);
  const phase = tick === null ? -1 : tick % 5;
  const label = phase <= 0 ? "search" : phase >= 4 ? "search" : "hit";
  const hits = [
    { y: 4, w: 30 },
    { y: 11, w: 22 },
    { y: 18, w: 14 },
  ] as const;
  // 0: probe only, 1: top hit, 2: top two, 3: all three, 4: clear
  const litCount = phase <= 0 || phase >= 4 ? 0 : phase;

  return (
    <div className="flex flex-col gap-1.5" aria-label="index search fan-out demo">
      <div className="flex items-center gap-2">
        <code
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-300",
            phase >= 0 ? tone.active : "border-fd-border text-fd-muted-foreground",
          )}
        >
          {label}
        </code>
        <span className="relative flex size-1.5 shrink-0" aria-hidden>
          {phase >= 0 && tick !== null ? <BeatPing key={tick} className={tone.wash} /> : null}
          <span
            className={cn(
              "size-1.5 rounded-full transition-colors duration-300",
              phase >= 0 ? tone.hairline : "bg-fd-border",
            )}
          />
        </span>
      </div>
      <svg viewBox="0 0 84 22" className="h-5 w-21" role="presentation" aria-hidden>
        <circle cx="8" cy="11" r="2.5" fill={IDLE} />
        <line
          x1="12"
          y1="11"
          x2="34"
          y2="11"
          stroke={BOX_LINE}
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        <motion.circle
          cy="11"
          r="2"
          fill={PACKET}
          initial={false}
          animate={{
            cx: phase >= 0 && phase < 4 ? 34 : 8,
            opacity: phase >= 0 && phase < 4 ? 1 : 0.35,
          }}
          transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.7 }}
        />
        {hits.map((hit, i) => (
          <g key={hit.y}>
            <line
              x1="34"
              y1="11"
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
              animate={{ opacity: i < litCount ? 0.95 - i * 0.15 : 0.12 }}
              transition={{ duration: 0.3 }}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
