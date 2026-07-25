/**
 * Features grid — structural layout adapted from better-auth/better-auth
 * `docs/components/docs/features.tsx` under the MIT License.
 * Copyright (c) 2024 - present, Bereket Engida.
 * See site/NOTICE. Content, icons, and background patterns are okengine-original.
 */

'use client';

import {
  Activity,
  AlarmClock,
  ArrowRight,
  Bell,
  BookOpen,
  Bot,
  Braces,
  CalendarClock,
  CircleDot,
  Cpu,
  Database,
  Fingerprint,
  Flag,
  FolderOpen,
  Gauge,
  Globe2,
  Hourglass,
  Inbox,
  KeyRound,
  Layers,
  ListOrdered,
  Mail,
  MessageSquare,
  MessagesSquare,
  Moon,
  Network,
  Quote,
  Radio,
  Search,
  Server,
  Settings2,
  Share2,
  ShieldBan,
  ShieldCheck,
  Timer,
  ToggleLeft,
  UserRound,
  Waves,
  Webhook,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  MotionConfig,
  motion,
  type Transition,
  type Variants,
} from 'framer-motion';
import Link from 'next/link';
import { useId, useState, type ReactNode, type SVGProps } from 'react';
import { cn } from '@/lib/cn';
import { ELEMENTS, type ElementPreviewKind } from '@/lib/elements';
import { useClientReducedMotion } from '@/lib/use-client-reduced-motion';

/** Snappy spring — micro-interactions, not ambient loops. */
const CHIP_SPRING: Transition = { type: 'spring', stiffness: 520, damping: 28, mass: 0.55 };

/** Card hover drives a staggered cascade through the preview row. */
const PREVIEW_ROW: Variants = {
  idle: {},
  hover: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } },
};

const PREVIEW_CHIP: Variants = {
  idle: { y: 0, scale: 1 },
  hover: { y: -3, scale: 1.04 },
};

/**
 * Eight-element feature grid (better-auth Features shell + okengine data).
 *
 * Numbered cells share hairline rules rather than gaps, so the eight elements
 * read as one table — the closed set is the point.
 */
export function Features() {
  return (
    /*
     * Reduced motion is applied in the tree via {@link useClientReducedMotion}.
     * Keep MotionConfig at `never` so Motion does not refuse transform animates
     * (and warn) while we are still gating those props ourselves.
     */
    <MotionConfig reducedMotion="never" transition={CHIP_SPRING}>
      <div className="not-prose w-full">
        <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border sm:grid-cols-2 lg:grid-cols-4">
          {ELEMENTS.map((feature, i) => (
            <FeatureCard key={feature.name} feature={feature} index={i} />
          ))}
        </ul>
      </div>
    </MotionConfig>
  );
}

/**
 * One element cell — hover/focus lights the preview chips as a micro-interaction.
 *
 * @param feature - Element descriptor
 * @param index - Zero-based grid index
 */
function FeatureCard({
  feature,
  index,
}: {
  feature: (typeof ELEMENTS)[number];
  index: number;
}) {
  const Icon = feature.icon;
  const [active, setActive] = useState(false);

  return (
    <li>
      <Link
        href={feature.href}
        onPointerEnter={() => setActive(true)}
        onPointerLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        className="group relative flex h-full min-h-56 flex-col overflow-hidden bg-fd-card px-5 py-4 transition-colors hover:bg-fd-secondary/40"
      >
        <Grid kind={feature.preview} />

        <div className="relative z-0 flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-fd-muted-foreground/70">
            {String(index + 1).padStart(2, '0')}
          </span>
          <motion.span
            aria-hidden
            animate={active ? { scale: 1.12, rotate: -6 } : { scale: 1, rotate: 0 }}
            transition={CHIP_SPRING}
            className={cn(
              'transition-colors',
              active ? 'text-fd-foreground' : 'text-fd-muted-foreground/70',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </motion.span>
        </div>

        <p className="relative z-0 mt-3 text-base font-semibold text-fd-foreground">
          {feature.name}
          <span className="ms-2 text-xs font-normal text-fd-muted-foreground">
            {feature.essence}
          </span>
        </p>
        <p className="relative z-0 mt-1 text-sm leading-snug text-fd-muted-foreground">
          {feature.description}
        </p>

        <div className="relative z-0 mt-auto pt-5">
          {previewFor(feature.preview, active)}
        </div>
      </Link>
    </li>
  );
}

/** Soft accent palette for preview chips — muted at rest, clearer on card hover. */
type ChipTone = 'sky' | 'amber' | 'emerald' | 'teal' | 'rose' | 'orange';

/** Border / wash / text for each tone (light + dark). */
const CHIP_TONE: Record<ChipTone, { idle: string; active: string; icon: string }> = {
  sky: {
    idle: 'border-sky-500/25 bg-sky-500/[0.06] text-sky-800/80 dark:text-sky-300/80',
    active: 'border-sky-500/45 bg-sky-500/15 text-sky-900 dark:text-sky-200',
    icon: 'text-sky-600 dark:text-sky-400',
  },
  amber: {
    idle: 'border-amber-500/25 bg-amber-500/[0.06] text-amber-900/80 dark:text-amber-300/80',
    active: 'border-amber-500/45 bg-amber-500/15 text-amber-950 dark:text-amber-200',
    icon: 'text-amber-600 dark:text-amber-400',
  },
  emerald: {
    idle: 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-800/80 dark:text-emerald-300/80',
    active: 'border-emerald-500/45 bg-emerald-500/15 text-emerald-900 dark:text-emerald-200',
    icon: 'text-emerald-600 dark:text-emerald-400',
  },
  teal: {
    idle: 'border-teal-500/25 bg-teal-500/[0.06] text-teal-800/80 dark:text-teal-300/80',
    active: 'border-teal-500/45 bg-teal-500/15 text-teal-900 dark:text-teal-200',
    icon: 'text-teal-600 dark:text-teal-400',
  },
  rose: {
    idle: 'border-rose-500/25 bg-rose-500/[0.06] text-rose-800/80 dark:text-rose-300/80',
    active: 'border-rose-500/45 bg-rose-500/15 text-rose-900 dark:text-rose-200',
    icon: 'text-rose-600 dark:text-rose-400',
  },
  orange: {
    idle: 'border-orange-500/25 bg-orange-500/[0.06] text-orange-900/80 dark:text-orange-300/80',
    active: 'border-orange-500/45 bg-orange-500/15 text-orange-950 dark:text-orange-200',
    icon: 'text-orange-600 dark:text-orange-400',
  },
};

/** One labeled chip in a multi-pill preview. */
type PreviewPillItem = {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly tone: ChipTone;
};

/**
 * Illustrative UI fragment from real API shapes in the specs.
 *
 * @param kind - Element preview kind
 * @param active - Whether the parent card is hovered or focused
 */
/** Shared chip chrome — one size and radius for every preview. */
const CHIP_SHELL = 'rounded-md border px-2 py-1 font-mono text-[10px] leading-none';

/**
 * Illustrative UI fragment from real API shapes in the specs.
 *
 * @param kind - Element preview kind
 * @param active - Whether the parent card is hovered or focused
 */
function previewFor(kind: ElementPreviewKind, active: boolean): ReactNode {
  switch (kind) {
    case 'flow':
      return (
        <PreviewChip active={active} icon={ArrowRight} tone="sky">
          on(http.post) → writes
        </PreviewChip>
      );
    case 'signal':
      return (
        <PreviewPills
          active={active}
          items={[
            { label: 'once', icon: CircleDot, tone: 'sky' },
            { label: 'broadcast', icon: Share2, tone: 'amber' },
            { label: 'live', icon: Activity, tone: 'emerald' },
          ]}
        />
      );
    case 'store':
      return (
        <PreviewPills
          active={active}
          items={[
            { label: 'sql', icon: Database, tone: 'sky' },
            { label: 'kv', icon: Braces, tone: 'amber' },
            { label: 'files', icon: FolderOpen, tone: 'teal' },
            { label: 'index', icon: Search, tone: 'orange' },
          ]}
        />
      );
    case 'clock':
      return (
        <PreviewChip active={active} icon={Timer} tone="amber">
          every(&quot;10m&quot;)
        </PreviewChip>
      );
    case 'gate':
      return (
        <PreviewChip active={active} icon={ShieldCheck} tone="emerald">
          .gate(member)
        </PreviewChip>
      );
    case 'vault':
      return (
        <PreviewChip active={active} icon={Fingerprint} tone="orange">
          <span className="tracking-wider">fp:••••a7c3</span>
        </PreviewChip>
      );
    case 'channel':
      return (
        <PreviewPills
          active={active}
          items={[
            { label: 'email', icon: Mail, tone: 'sky' },
            { label: 'SMS', icon: MessageSquare, tone: 'teal' },
            { label: 'push', icon: Bell, tone: 'amber' },
          ]}
        />
      );
    case 'ai':
      return (
        <PreviewChip active={active} icon={ShieldBan} tone="rose">
          allowPii: denied
        </PreviewChip>
      );
  }
}

/**
 * Single preview chip — icon + label with a soft tone; pops on card hover.
 *
 * @param active - Parent card hover/focus
 * @param icon - Leading Lucide icon
 * @param tone - Accent palette
 * @param children - Chip label
 */
function PreviewChip({
  active,
  icon: Icon,
  tone,
  children,
}: {
  active: boolean;
  icon: LucideIcon;
  tone: ChipTone;
  children: ReactNode;
}) {
  const reduced = useClientReducedMotion();
  const palette = CHIP_TONE[tone];

  return (
    <motion.span
      className={cn(
        CHIP_SHELL,
        'inline-flex origin-left items-center gap-1.5 transition-colors',
        active ? palette.active : palette.idle,
      )}
      variants={PREVIEW_CHIP}
      initial="idle"
      animate={reduced ? 'idle' : active ? 'hover' : 'idle'}
      whileHover={reduced ? undefined : { scale: 1.06, y: -4 }}
      whileTap={reduced ? undefined : { scale: 0.97 }}
      transition={CHIP_SPRING}
    >
      <Icon className={cn('size-3 shrink-0', palette.icon)} aria-hidden strokeWidth={1.75} />
      <span>{children}</span>
    </motion.span>
  );
}

/**
 * Multi-chip preview row — each pill has its own icon and tone; cascade on hover.
 *
 * @param active - Parent card hover/focus
 * @param items - Chip labels with icons and tones
 */
function PreviewPills({
  active,
  items,
}: {
  active: boolean;
  items: ReadonlyArray<PreviewPillItem>;
}) {
  const reduced = useClientReducedMotion();

  return (
    <motion.div
      className="flex flex-wrap gap-1.5"
      variants={PREVIEW_ROW}
      initial="idle"
      animate={reduced ? 'idle' : active ? 'hover' : 'idle'}
    >
      {items.map(({ label, icon: Icon, tone }) => {
        const palette = CHIP_TONE[tone];
        return (
          <motion.span
            key={label}
            variants={PREVIEW_CHIP}
            whileHover={
              reduced
                ? undefined
                : {
                    scale: 1.08,
                    y: -4,
                  }
            }
            whileTap={reduced ? undefined : { scale: 0.96 }}
            transition={CHIP_SPRING}
            className={cn(
              CHIP_SHELL,
              'inline-flex origin-center items-center gap-1.5 transition-colors',
              active ? palette.active : palette.idle,
            )}
          >
            <Icon className={cn('size-3 shrink-0', palette.icon)} aria-hidden strokeWidth={1.75} />
            {label}
          </motion.span>
        );
      })}
    </motion.div>
  );
}

/**
 * One zoo mark in a card — the concern an element collapses, placed in % space
 * so it stays clear of the title/preview chrome.
 */
type ZooMark = {
  readonly icon: LucideIcon;
  /** Horizontal anchor, 0–100 (% of card width). */
  readonly x: number;
  /** Vertical anchor, 0–100 (% of card height). */
  readonly y: number;
  /** Icon size in px. */
  readonly size: number;
};

/**
 * The zoo each element replaces — many icons per block, not one repeated mark.
 * Positions sit in the upper field and side gutters so body text stays readable.
 */
const ZOO: Record<ElementPreviewKind, ReadonlyArray<ZooMark>> = {
  flow: [
    { icon: Globe2, x: 18, y: 14, size: 13 },
    { icon: Workflow, x: 72, y: 18, size: 12 },
    { icon: Timer, x: 88, y: 42, size: 11 },
    { icon: Inbox, x: 12, y: 48, size: 12 },
    { icon: Webhook, x: 58, y: 8, size: 11 },
  ],
  signal: [
    { icon: ListOrdered, x: 16, y: 16, size: 12 },
    { icon: Share2, x: 78, y: 14, size: 12 },
    { icon: Waves, x: 90, y: 40, size: 13 },
    { icon: Network, x: 10, y: 46, size: 12 },
    { icon: Radio, x: 54, y: 10, size: 11 },
  ],
  store: [
    { icon: Database, x: 20, y: 12, size: 13 },
    { icon: Zap, x: 76, y: 16, size: 11 },
    { icon: Braces, x: 88, y: 44, size: 12 },
    { icon: FolderOpen, x: 12, y: 50, size: 12 },
    { icon: Search, x: 56, y: 8, size: 11 },
  ],
  clock: [
    { icon: CalendarClock, x: 18, y: 14, size: 13 },
    { icon: Hourglass, x: 74, y: 16, size: 12 },
    { icon: Timer, x: 90, y: 42, size: 11 },
    { icon: Moon, x: 12, y: 48, size: 12 },
    { icon: AlarmClock, x: 52, y: 8, size: 11 },
  ],
  gate: [
    { icon: Fingerprint, x: 16, y: 14, size: 12 },
    { icon: UserRound, x: 76, y: 16, size: 12 },
    { icon: ShieldCheck, x: 88, y: 42, size: 12 },
    { icon: Gauge, x: 12, y: 48, size: 12 },
    { icon: Flag, x: 54, y: 8, size: 11 },
    { icon: ToggleLeft, x: 40, y: 52, size: 11 },
  ],
  vault: [
    { icon: KeyRound, x: 20, y: 14, size: 13 },
    { icon: Settings2, x: 78, y: 18, size: 12 },
    { icon: Server, x: 88, y: 44, size: 12 },
    { icon: Braces, x: 14, y: 48, size: 11 },
  ],
  channel: [
    { icon: Mail, x: 18, y: 14, size: 13 },
    { icon: MessageSquare, x: 76, y: 16, size: 12 },
    { icon: MessagesSquare, x: 88, y: 42, size: 12 },
    { icon: Bell, x: 12, y: 48, size: 12 },
  ],
  ai: [
    { icon: Cpu, x: 18, y: 14, size: 13 },
    { icon: Quote, x: 76, y: 16, size: 12 },
    { icon: Layers, x: 88, y: 42, size: 12 },
    { icon: Bot, x: 12, y: 48, size: 12 },
    { icon: BookOpen, x: 54, y: 8, size: 11 },
  ],
};

/** Base drift period — soft enough to read as ambient, not busy. */
const DRIFT_MS = 7;

/** Shared infinite ease for zoo marks. */
const DRIFT: Transition = {
  duration: DRIFT_MS,
  repeat: Infinity,
  ease: 'easeInOut',
};

/**
 * Decorative lattice wash — fine dots plus the zoo of concerns each element
 * collapses, drifting gently so the closed set feels alive.
 *
 * @param kind - Element preview kind; selects that block's zoo marks
 */
export function Grid({ kind }: { kind: ElementPreviewKind }) {
  const reduced = useClientReducedMotion();
  const marks = ZOO[kind];

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-2/3 bg-linear-to-b from-fd-foreground/[0.04] to-transparent opacity-80 transition-opacity group-hover:opacity-100"
      />
      <div className="absolute inset-0 mask-[linear-gradient(to_bottom,black_0%,black_42%,transparent_88%)]">
        <GridPattern
          pitch={16}
          className="absolute inset-0 h-full w-full text-fd-foreground/10 transition-colors group-hover:text-fd-foreground/[0.16]"
        />
        {marks.map((mark, idx) => {
          const Icon = mark.icon;
          const phase = idx % 3;
          const driftX = phase === 0 ? [0, 3, -2, 0] : phase === 1 ? [0, -3, 2, 0] : [0, 2, 3, 0];
          const driftY = phase === 0 ? [0, -4, 2, 0] : phase === 1 ? [0, 3, -3, 0] : [0, -2, 4, 0];
          const half = mark.size / 2;

          return (
            <motion.span
              key={`${kind}-${Icon.displayName ?? idx}`}
              aria-hidden
              className="absolute text-fd-foreground/14 group-hover:text-fd-foreground/24"
              style={{
                left: `${mark.x}%`,
                top: `${mark.y}%`,
                width: `${mark.size}px`,
                height: `${mark.size}px`,
                marginLeft: `${-half}px`,
                marginTop: `${-half}px`,
                opacity: 0.45,
              }}
              initial={false}
              animate={
                reduced
                  ? { opacity: 0.55 }
                  : {
                      x: driftX,
                      y: driftY,
                      opacity: [0.45, 0.85, 0.55, 0.45],
                    }
              }
              transition={{
                ...DRIFT,
                duration: DRIFT_MS + phase * 1.4,
                delay: idx * 0.35,
              }}
            >
              <Icon className="size-full" strokeWidth={1.25} />
            </motion.span>
          );
        })}
      </div>
    </div>
  );
}

type GridPatternProps = SVGProps<SVGSVGElement> & {
  pitch: number;
};

/**
 * SVG dot field used by {@link Grid}.
 *
 * @param props - Pitch and SVG attributes
 */
export function GridPattern({ pitch, ...props }: GridPatternProps) {
  const patternId = useId();

  return (
    <svg aria-hidden="true" {...props}>
      <defs>
        <pattern
          id={patternId}
          width={pitch}
          height={pitch}
          patternUnits="userSpaceOnUse"
          x="8"
          y="6"
        >
          <circle cx="0.75" cy="0.75" r="0.75" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
