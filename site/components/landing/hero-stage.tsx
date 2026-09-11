/**
 * Hero walk — the create Flow stepping through fx, shared by the left-column
 * code panel and the right-column lattice.
 */

"use client";

import { AnimatePresence, MotionConfig, motion, useInView } from "framer-motion";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ElementLattice } from "@/components/landing/element-lattice";
import { PrismBackdrop } from "@/components/landing/prism-backdrop";
import { cn } from "@/lib/cn";
import { ELEMENTS } from "@/lib/elements";
import { elementToneVar } from "@/lib/element-tones";
import type { HeroCodeLine } from "@/lib/hero-code";
import { HERO_FX_BEATS, heroFxElementIndex } from "@/lib/hero-fx";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

const BEAT_MS = 2200;

type HeroWalkValue = {
  readonly beat: number;
  readonly hold: (index: number | null) => void;
};

const HeroWalkContext = createContext<HeroWalkValue | null>(null);

function useHeroWalk(): HeroWalkValue {
  const value = useContext(HeroWalkContext);
  if (!value) {
    throw new Error("useHeroWalk must be used within HeroWalkProvider");
  }
  return value;
}

/**
 * Owns the fx-walk clock so the code panel and lattice stay on the same beat.
 *
 * @param children - Hero columns
 */
export function HeroWalkProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const reduced = useClientReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { margin: "-12% 0px" });
  const [walk, setWalk] = useState(0);
  const [held, setHeld] = useState<number | null>(null);

  useEffect(() => {
    if (reduced || !inView || held !== null) return;
    const timer = window.setInterval(() => setWalk((current) => current + 1), BEAT_MS);
    return () => window.clearInterval(timer);
  }, [reduced, inView, held]);

  const beat = held ?? walk % HERO_FX_BEATS.length;
  const value = useMemo(() => ({ beat, hold: setHeld }) satisfies HeroWalkValue, [beat]);

  return (
    <HeroWalkContext.Provider value={value}>
      <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </HeroWalkContext.Provider>
  );
}

/**
 * Left-column code walk — hover or press a line to pin that fx beat.
 *
 * @param lines - Shiki-tokenised walk from `loadHeroCodeLines()`
 */
export function HeroFxCode({ lines }: { readonly lines: ReadonlyArray<HeroCodeLine> }): ReactNode {
  const reduced = useClientReducedMotion();
  const { beat, hold } = useHeroWalk();
  const current = HERO_FX_BEATS[beat]!;

  return (
    <MotionConfig reducedMotion="never">
      <figure className="not-prose m-0 flex h-full w-full flex-col overflow-hidden">
        <figcaption className="flex items-center justify-between gap-3 border-b border-fd-border px-4 py-2.5">
          <span className="flex items-center gap-2 font-mono text-[11px] text-fd-muted-foreground">
            <span
              aria-hidden
              className="sently-dot-pulse size-1 rounded-full bg-fd-foreground/60"
            />
            src/flows/notes/create.ts
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={current.preview}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduced ? undefined : { opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="font-mono text-[11px] tracking-[0.12em] uppercase"
              style={{ color: elementToneVar(current.preview) }}
            >
              {current.preview}
            </motion.span>
          </AnimatePresence>
        </figcaption>

        {/* `shiki` hands the token spans their dual-theme ink; focus is opacity. */}
        <ol className="shiki min-h-0 flex-1 overflow-x-auto px-3 py-4 font-mono text-xs leading-[1.85] sm:text-[13px]">
          {lines.map((line, index) => {
            const lit = line.beat === beat;
            const dim = line.beat !== null && line.beat !== beat;
            return (
              <li key={index}>
                <button
                  type="button"
                  disabled={line.beat === null}
                  onClick={() => {
                    if (line.beat === null) return;
                    hold(line.beat);
                  }}
                  onPointerEnter={() => {
                    if (line.beat !== null) hold(line.beat);
                  }}
                  onPointerLeave={() => hold(null)}
                  className={cn(
                    "flex w-full rounded-sm px-1.5 text-left transition-[opacity,background-color] duration-200",
                    line.beat === null ? "cursor-default opacity-45" : "cursor-pointer",
                    lit && "bg-fd-secondary/50 opacity-100",
                    dim && "opacity-50",
                    line.beat !== null && !lit && !dim && "opacity-80",
                  )}
                >
                  <span
                    aria-hidden
                    className="me-3 w-4 shrink-0 text-right text-[10px] text-fd-muted-foreground/40"
                  >
                    {index + 1}
                  </span>
                  <code
                    className="min-w-0 flex-1 bg-transparent whitespace-pre"
                    style={
                      lit
                        ? {
                            boxShadow: `inset 2px 0 0 ${elementToneVar(current.preview)}`,
                            paddingLeft: "0.5rem",
                          }
                        : undefined
                    }
                  >
                    {line.tokens.map((token, tokenIndex) => (
                      <span key={tokenIndex} style={token.style}>
                        {token.content}
                      </span>
                    ))}
                  </code>
                </button>
              </li>
            );
          })}
        </ol>
      </figure>
    </MotionConfig>
  );
}

/**
 * Hero backdrop tinted by whatever element the walk is on, so the light behind
 * the copy is the same ink as the lit slab.
 */
export function HeroPrism(): ReactNode {
  const { beat } = useHeroWalk();
  const current = HERO_FX_BEATS[beat]!;

  return <PrismBackdrop tone={elementToneVar(current.preview)} />;
}

/**
 * Foot rail of the merged stage: what the lit line is doing on the left, the
 * CI-measured facts the caller passes in on the right.
 *
 * @param facts - Measured / contract cells rendered on the trailing edge
 */
export function HeroRail({ facts }: { readonly facts: ReactNode }): ReactNode {
  const reduced = useClientReducedMotion();
  const { beat } = useHeroWalk();
  const current = HERO_FX_BEATS[beat]!;
  const focused = ELEMENTS[heroFxElementIndex(current.preview)];

  return (
    <MotionConfig reducedMotion="never">
      <div className="flex flex-col gap-2 border-t border-fd-border px-4 py-3 font-mono text-[11px] sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="flex min-w-0 items-center gap-2">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={current.preview}
              initial={reduced ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -3 }}
              transition={{ duration: 0.18 }}
              className="flex min-w-0 items-center gap-2"
            >
              <span
                aria-hidden
                className="size-1 shrink-0 rounded-full"
                style={{ backgroundColor: elementToneVar(current.preview) }}
              />
              <span className="truncate text-fd-muted-foreground">{current.note}</span>
              {focused ? (
                <span className="shrink-0 text-fd-muted-foreground/60">· {focused.name}</span>
              ) : null}
            </motion.span>
          </AnimatePresence>
        </p>
        {facts}
      </div>
    </MotionConfig>
  );
}

/**
 * Right-column lattice driven by the same fx walk as {@link HeroFxCode}.
 */
export function HeroLattice(): ReactNode {
  const reduced = useClientReducedMotion();
  const { beat, hold } = useHeroWalk();
  const current = HERO_FX_BEATS[beat]!;
  const guidedIndex = reduced ? 0 : heroFxElementIndex(current.preview);

  return (
    <div className="flex h-full w-full flex-col">
      {/* Mirrors the code figure's caption bar so both stage cells share chrome. */}
      <p className="flex items-center justify-between gap-3 border-b border-fd-border px-4 py-2.5 font-mono text-[11px] text-fd-muted-foreground">
        <span>eight elements · no ninth</span>
        <span className="hidden text-fd-muted-foreground/60 lg:inline">
          hover a line, or a slab
        </span>
      </p>
      <div className="flex min-h-0 flex-1 items-center px-4 py-3">
        <ElementLattice
          guidedIndex={guidedIndex}
          onHoverIndex={(index) => {
            if (index === null) {
              hold(null);
              return;
            }
            const match = HERO_FX_BEATS.findIndex(
              (entry) => heroFxElementIndex(entry.preview) === index,
            );
            hold(match >= 0 ? match : null);
          }}
        />
      </div>
    </div>
  );
}
