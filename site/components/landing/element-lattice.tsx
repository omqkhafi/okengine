/**
 * Element lattice — original okengine hero visual.
 *
 * The eight elements laid out as a periodic table: the project's own metaphor
 * (an element earns its place only if it has irreducible physics), so the hero
 * shows what you actually import rather than a build artifact.
 *
 * Motion carries the same claim. The cells deal in once on mount, a spotlight
 * follows the pointer across the panel, and the hovered or focused cell takes a
 * single shared highlight that glides from wherever it last was — one lit cell
 * at a time, never eight competing ones. While nobody is pointing, a beat walks
 * the ring one element per period and the header reads out what that element
 * replaces, so the panel argues for itself without being touched.
 *
 * Everything is spring-driven through one `MotionConfig`. We honor
 * prefers-reduced-motion ourselves (after hydration) rather than via
 * `reducedMotion="user"`, so a reduced-motion visitor gets the finished
 * lattice with no ambient movement — and Motion does not warn while skipping
 * transform/layout animates it would otherwise refuse.
 */

'use client';

import { AnimatePresence, motion, MotionConfig, useMotionTemplate, useMotionValue } from 'framer-motion';
import type { Transition, Variants } from 'framer-motion';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { ELEMENTS, type ElementPreviewKind } from '@/lib/elements';
import { useClientReducedMotion } from '@/lib/use-client-reduced-motion';

/** One spring for every lattice transition, so the panel moves as one object. */
const SPRING: Transition = { type: 'spring', stiffness: 380, damping: 34, mass: 0.8 };

/** Idle walk period — one element per beat, eight beats per pass. */
const BEAT_MS = 2400;

/**
 * Soft wash per element — active cell gets a pastel tint, beat walk a fainter
 * echo. Tones stay muted so the lattice reads as one panel, not a rainbow.
 */
const ELEMENT_TONE: Record<
  ElementPreviewKind,
  { readonly wash: string; readonly lit: string; readonly hairline: string; readonly mark: string }
> = {
  flow: {
    wash: 'bg-sky-500/14 dark:bg-sky-400/16',
    lit: 'bg-sky-500/[0.07] dark:bg-sky-400/[0.09]',
    hairline: 'bg-sky-500/55 dark:bg-sky-400/50',
    mark: 'text-sky-700 dark:text-sky-300',
  },
  signal: {
    wash: 'bg-amber-500/14 dark:bg-amber-400/16',
    lit: 'bg-amber-500/[0.07] dark:bg-amber-400/[0.09]',
    hairline: 'bg-amber-500/55 dark:bg-amber-400/50',
    mark: 'text-amber-800 dark:text-amber-300',
  },
  store: {
    wash: 'bg-teal-500/14 dark:bg-teal-400/16',
    lit: 'bg-teal-500/[0.07] dark:bg-teal-400/[0.09]',
    hairline: 'bg-teal-500/55 dark:bg-teal-400/50',
    mark: 'text-teal-700 dark:text-teal-300',
  },
  clock: {
    wash: 'bg-orange-500/14 dark:bg-orange-400/16',
    lit: 'bg-orange-500/[0.07] dark:bg-orange-400/[0.09]',
    hairline: 'bg-orange-500/55 dark:bg-orange-400/50',
    mark: 'text-orange-800 dark:text-orange-300',
  },
  gate: {
    wash: 'bg-emerald-500/14 dark:bg-emerald-400/16',
    lit: 'bg-emerald-500/[0.07] dark:bg-emerald-400/[0.09]',
    hairline: 'bg-emerald-500/55 dark:bg-emerald-400/50',
    mark: 'text-emerald-700 dark:text-emerald-300',
  },
  vault: {
    wash: 'bg-yellow-500/14 dark:bg-yellow-400/14',
    lit: 'bg-yellow-500/[0.07] dark:bg-yellow-400/[0.08]',
    hairline: 'bg-yellow-600/50 dark:bg-yellow-400/45',
    mark: 'text-yellow-800 dark:text-yellow-300',
  },
  channel: {
    wash: 'bg-cyan-500/14 dark:bg-cyan-400/16',
    lit: 'bg-cyan-500/[0.07] dark:bg-cyan-400/[0.09]',
    hairline: 'bg-cyan-500/55 dark:bg-cyan-400/50',
    mark: 'text-cyan-700 dark:text-cyan-300',
  },
  ai: {
    wash: 'bg-rose-500/14 dark:bg-rose-400/16',
    lit: 'bg-rose-500/[0.07] dark:bg-rose-400/[0.09]',
    hairline: 'bg-rose-500/55 dark:bg-rose-400/50',
    mark: 'text-rose-700 dark:text-rose-300',
  },
};

/** Panel parts arrive top to bottom; the grid runs its own stagger inside. */
const PANEL: Variants = {
  hidden: {},
  shown: { transition: { delayChildren: 0.08, staggerChildren: 0.09 } },
};

const GRID: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.05 } },
};

const CELL: Variants = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0 },
};

/** Opacity-only entrance when the visitor prefers reduced motion. */
const CELL_STATIC: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1 },
};

/**
 * Hero-column grid of the eight elements — symbol, name, and essence per cell,
 * each linking to its reference page.
 */
export function ElementLattice() {
  const reduced = useClientReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const [pointing, setPointing] = useState(false);
  /*
   * `null` until the first beat lands. Server-rendered HTML and the hydration
   * render therefore agree on an unlit lattice whatever the visitor's motion
   * preference, and the walk only ever starts a period after mount.
   */
  const [beat, setBeat] = useState<number | null>(null);

  /** The walk yields to a real pointer, and never starts under reduced motion. */
  const walking = !reduced && active === null;
  const cell = reduced ? CELL_STATIC : CELL;

  useEffect(() => {
    if (!walking) return;
    const timer = window.setInterval(
      () => setBeat((current) => (current === null ? 0 : current + 1)),
      BEAT_MS,
    );
    return () => window.clearInterval(timer);
  }, [walking]);

  const lit = walking && beat !== null ? beat % ELEMENTS.length : null;
  const focus = active ?? lit;
  const focused = focus === null ? null : ELEMENTS[focus]!;

  /* Pointer position in panel space, for the spotlight mask. */
  const pointerX = useMotionValue(-9999);
  const pointerY = useMotionValue(-9999);
  const spotlight = useMotionTemplate`radial-gradient(14rem circle at ${pointerX}px ${pointerY}px, black, transparent 70%)`;

  return (
    /*
     * Drive reduced motion in the tree below. `reducedMotion="user"` would let
     * Motion refuse transform/layout animates and log a dev warning; we simply
     * never request those animates when `reduced` is set.
     */
    <MotionConfig reducedMotion="never" transition={SPRING}>
      <div className="relative w-full max-w-[38rem]">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-6 bg-grid-black/[0.02] mask-[radial-gradient(70%_60%_at_50%_45%,white,transparent)] dark:bg-grid-white/[0.02]"
        />

        <motion.div
          initial={reduced ? false : 'hidden'}
          animate="shown"
          variants={PANEL}
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            pointerX.set(event.clientX - box.left);
            pointerY.set(event.clientY - box.top);
          }}
          onPointerEnter={() => setPointing(true)}
          onPointerLeave={() => {
            setPointing(false);
            setActive(null);
          }}
          className="relative overflow-hidden rounded-xl border border-fd-border bg-fd-card"
        >
          {/* Spotlight — a wash the pointer carries, masked to a soft circle. */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-fd-foreground/[0.05]"
            style={{ maskImage: spotlight }}
            initial={false}
            animate={{ opacity: pointing ? 1 : 0 }}
            transition={{ duration: reduced ? 0 : 0.3 }}
          />

          <motion.div
            variants={cell}
            className="relative flex items-baseline justify-between gap-4 border-b border-fd-border px-4 py-3"
          >
            <p className="font-mono text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase">
              eight elements
            </p>

            {/* Reads out what the element under the beat or the pointer replaces. */}
            <div className="relative h-4 min-w-0 flex-1">
              <AnimatePresence initial={false}>
                <motion.p
                  key={focused?.name ?? 'law'}
                  initial={reduced ? false : { opacity: 0, y: 5 }}
                  animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -5 }}
                  transition={{ duration: reduced ? 0 : 0.22, ease: 'easeOut' }}
                  className="absolute inset-0 truncate text-right text-[11px] text-fd-muted-foreground"
                >
                  {focused ? (
                    <>
                      <span className="text-fd-foreground">{focused.name}</span> replaces{' '}
                      {focused.replaces}
                    </>
                  ) : (
                    'irreducible physics only'
                  )}
                </motion.p>
              </AnimatePresence>
            </div>
          </motion.div>

          <motion.ul variants={GRID} className="grid grid-cols-2 gap-px bg-fd-border sm:grid-cols-4">
            {ELEMENTS.map((element, i) => {
              const Icon = element.icon;
              const tone = ELEMENT_TONE[element.preview];
              const isActive = active === i;
              const isLit = lit === i;
              const highlighted = isActive || isLit;
              return (
                <motion.li key={element.name} variants={cell} className="relative bg-fd-card">
                  {/* One shared highlight for the whole grid: it glides, it never blinks. */}
                  {isActive ? (
                    reduced ? (
                      <span aria-hidden className={cn('absolute inset-0', tone.wash)} />
                    ) : (
                      <motion.span
                        layoutId="oke-lattice-cell"
                        aria-hidden
                        className={cn('absolute inset-0', tone.wash)}
                      />
                    )
                  ) : null}

                  {/* The beat's own, fainter wash — no layout, so the two never fight. */}
                  <motion.span
                    aria-hidden
                    className={cn('absolute inset-0', tone.lit)}
                    initial={false}
                    animate={{ opacity: isLit ? 1 : 0 }}
                    transition={{ duration: reduced ? 0 : 0.5, ease: 'easeOut' }}
                  />

                  <Link
                    href={element.href}
                    onPointerEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className="relative flex h-full flex-col p-4"
                  >
                    <div className="flex items-start justify-between">
                      {/*
                       * Colour stays in classes rather than an animated `color`:
                       * an animated value resolves the theme variable to a fixed
                       * rgb, which then survives a theme switch as inline style.
                       */}
                      <span
                        className={cn(
                          'font-mono text-[10px] transition-colors',
                          highlighted ? tone.mark : 'text-fd-muted-foreground/70',
                        )}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <motion.span
                        aria-hidden
                        className={cn(
                          'transition-colors',
                          highlighted ? tone.mark : 'text-fd-muted-foreground/70',
                        )}
                        animate={reduced ? undefined : { scale: isActive ? 1.15 : 1 }}
                      >
                        <Icon className="size-3.5" aria-hidden />
                      </motion.span>
                    </div>

                    <motion.span
                      className={cn(
                        'mt-7 block font-mono text-2xl leading-none font-medium tracking-tight transition-colors',
                        highlighted ? tone.mark : 'text-fd-foreground',
                      )}
                      animate={reduced ? undefined : { y: isActive ? -2 : 0 }}
                    >
                      {element.symbol}
                    </motion.span>
                    <span className="mt-2 block text-sm font-medium text-fd-foreground">
                      {element.name}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-fd-muted-foreground">
                      {element.essence}
                    </span>

                    {/* Hairline that draws in under the cell you are on. */}
                    <motion.span
                      aria-hidden
                      className={cn(
                        'absolute inset-x-0 bottom-0 h-px origin-left',
                        tone.hairline,
                        reduced && (isActive ? 'scale-x-100' : 'scale-x-0'),
                      )}
                      initial={false}
                      animate={reduced ? undefined : { scaleX: isActive ? 1 : 0 }}
                      transition={{ duration: 0.28, ease: 'easeOut' }}
                    />
                  </Link>
                </motion.li>
              );
            })}
          </motion.ul>

          <motion.div
            variants={cell}
            className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-fd-border px-4 py-3"
          >
            {/* Idle beat walks a highlight along the footer rule. */}
            {lit === null || beat === null || reduced ? null : (
              <motion.span
                key={beat}
                aria-hidden
                className="pointer-events-none absolute -top-px left-0 h-px w-1/4"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, var(--color-fd-foreground), transparent)',
                }}
                initial={{ x: '-100%', opacity: 0 }}
                animate={{ x: '400%', opacity: [0, 0.5, 0] }}
                transition={{ duration: 1.5, ease: 'easeInOut' }}
              />
            )}

            {/*
             * Footer mirrors the header: header says what the lit element replaces;
             * footer points at the reference page and what the element is for.
             */}
            <div className="relative h-4 min-w-0 flex-1">
              <AnimatePresence initial={false}>
                <motion.div
                  key={focused?.name ?? 'idle'}
                  initial={reduced ? false : { opacity: 0, y: 5 }}
                  animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -5 }}
                  transition={{ duration: reduced ? 0 : 0.22, ease: 'easeOut' }}
                  className="absolute inset-0 flex items-baseline justify-between gap-x-4"
                >
                  {focused ? (
                    <>
                      <Link
                        href={focused.href}
                        className="shrink-0 font-mono text-xs text-fd-foreground underline-offset-2 hover:underline"
                      >
                        docs/elements/{focused.preview}
                      </Link>
                      <p className="min-w-0 truncate text-right text-[11px] text-fd-muted-foreground">
                        {focused.description}
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] text-fd-muted-foreground">
                      New infrastructure is a driver — never a ninth element.
                    </p>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </MotionConfig>
  );
}
