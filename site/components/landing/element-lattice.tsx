/**
 * Element lattice — isometric slabs for the eight elements.
 *
 * Same claim as the periodic table: eight seats, no ninth. The field is a
 * Three.js 4×2 of rounded keycaps with real thickness. A pointer or the idle
 * walk lifts one slab (drop-lines mark the rise) and the caption reads out
 * what that element replaces. The lid mark is the two-letter symbol, same
 * role as Vite's "TS". Touch uses tap / focus; prefers-reduced-motion paints
 * the finished field with no lift or walk.
 */

"use client";

import { AnimatePresence, motion, MotionConfig, type Transition } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ELEMENTS } from "@/lib/elements";
import { elementToneVar } from "@/lib/element-tones";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

type IsoTileSpec = {
  readonly symbol: string;
  readonly preview: string;
};

type IsoHandle = {
  setLit: (index: number | null) => void;
  dispose: () => void;
};

/** One spring for caption swaps — same seat as the rest of the landing. */
const SPRING: Transition = { type: "spring", stiffness: 380, damping: 34, mass: 0.8 };

/** Idle walk period — one element per beat, eight beats per pass. */
const BEAT_MS = 2400;

const TILES: readonly IsoTileSpec[] = ELEMENTS.map((element) => ({
  symbol: element.symbol,
  preview: element.preview,
}));

/**
 * True when the device has a fine pointer with hover — hover lift.
 * Coarse / touch-only devices rely on tap, focus, and the idle walk.
 */
function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setFine(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return fine;
}

/** Optional host control — the homepage fx walk drives which cap is lit. */
export type ElementLatticeProps = {
  /**
   * When set, the parent drives which cap is lit and the idle walk stops.
   * `null` means nothing lit unless the pointer is over a cap.
   */
  readonly guidedIndex?: number | null;
  /**
   * Pointer/keyboard hover index only — not the composed guided/idle focus.
   *
   * @param index - Hovered cap, or `null` when the pointer leaves
   */
  readonly onHoverIndex?: (index: number | null) => void;
};

/**
 * Hero-column field of the eight elements — one isometric slab per export,
 * each linking to its reference page. The caption under the canvas is the
 * reading: name, what it replaces, and the docs path.
 *
 * @param guidedIndex - Parent-driven lit cap; omit for the idle walk
 * @param onHoverIndex - Hover reporter for a parent code walk
 */
export function ElementLattice({ guidedIndex, onHoverIndex }: ElementLatticeProps = {}) {
  const reduced = useClientReducedMotion();
  const finePointer = useFinePointer();
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<IsoHandle | null>(null);
  const onHoverIndexRef = useRef(onHoverIndex);
  onHoverIndexRef.current = onHoverIndex;
  const [active, setActive] = useState<number | null>(null);
  const [beat, setBeat] = useState<number | null>(null);

  const guided = guidedIndex !== undefined;
  const walking = !reduced && active === null && !guided;
  const focus =
    active ?? (guided ? guidedIndex : walking && beat !== null ? beat % ELEMENTS.length : null);
  const focused = focus === null ? null : ELEMENTS[focus];

  useEffect(() => {
    if (!walking) return;
    const timer = window.setInterval(
      () => setBeat((current) => (current === null ? 0 : current + 1)),
      BEAT_MS,
    );
    return () => window.clearInterval(timer);
  }, [walking]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let handle: IsoHandle | null = null;

    void import("@/lib/iso-scene").then(({ mountIsoLattice }) => {
      if (disposed || !canvasRef.current) return;
      handle = mountIsoLattice({
        canvas,
        tiles: TILES,
        reduced,
        onHover: (index) => {
          if (!finePointer && index === null) return;
          setActive(index);
          onHoverIndexRef.current?.(index);
        },
        onSelect: (index, event) => {
          const href = ELEMENTS[index]?.href;
          if (!href) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey) {
            window.open(href, "_blank", "noopener,noreferrer");
            return;
          }
          router.push(href);
        },
      });
      handleRef.current = handle;
      handle.setLit(focus);
    });

    return () => {
      disposed = true;
      handle?.dispose();
      handleRef.current = null;
    };
  }, [reduced, finePointer, router]);

  useEffect(() => {
    handleRef.current?.setLit(focus);
  }, [focus]);

  return (
    <MotionConfig reducedMotion="never" transition={SPRING}>
      <div className="relative mx-auto w-full max-w-[52rem]">
        <div className="oke-iso-stage touch-none select-none">
          <canvas ref={canvasRef} aria-hidden className="oke-iso-canvas font-mono" />
        </div>

        <nav className="sr-only" aria-label="Eight elements">
          {ELEMENTS.map((element, i) => (
            <Link
              key={element.name}
              href={element.href}
              onFocus={() => {
                setActive(i);
                onHoverIndexRef.current?.(i);
              }}
              onBlur={() => {
                setActive(null);
                onHoverIndexRef.current?.(null);
              }}
            >
              {element.name} — {element.essence}
            </Link>
          ))}
        </nav>

        <div className="relative mt-3 h-5 sm:mt-4">
          <AnimatePresence initial={false}>
            <motion.p
              key={focused?.name ?? "idle"}
              initial={reduced ? false : { opacity: 0, y: 5 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -5 }}
              transition={{ duration: reduced ? 0 : 0.22, ease: "easeOut" }}
              className="absolute inset-0 truncate text-center text-xs leading-5 text-fd-muted-foreground"
            >
              {focused ? (
                <>
                  <span className="font-medium" style={{ color: elementToneVar(focused.preview) }}>
                    {focused.name}
                  </span>{" "}
                  replaces {focused.replaces} ·{" "}
                  <Link
                    href={focused.href}
                    className="font-mono text-[11px] underline-offset-2 hover:underline"
                  >
                    docs/elements/{focused.preview}
                  </Link>
                </>
              ) : (
                "Eight elements — irreducible physics only."
              )}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  );
}
