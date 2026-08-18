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

/**
 * Hero-column field of the eight elements — one isometric slab per export,
 * each linking to its reference page. The caption under the canvas is the
 * reading: name, what it replaces, and the docs path.
 */
export function ElementLattice() {
  const reduced = useClientReducedMotion();
  const finePointer = useFinePointer();
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<IsoHandle | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [beat, setBeat] = useState<number | null>(null);

  const walking = !reduced && active === null;
  const focus = active ?? (walking && beat !== null ? beat % ELEMENTS.length : null);
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
      <div className="relative w-full max-w-[42rem]">
        <div className="oke-iso-stage touch-none select-none">
          <canvas ref={canvasRef} aria-hidden className="oke-iso-canvas font-mono" />
        </div>

        <nav className="sr-only" aria-label="Eight elements">
          {ELEMENTS.map((element, i) => (
            <Link
              key={element.name}
              href={element.href}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              {element.name} — {element.essence}
            </Link>
          ))}
        </nav>

        <div className="mt-1 flex items-center justify-between gap-3 sm:mt-2">
          <p className="shrink-0 font-mono text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase">
            eight elements
          </p>
          <div className="relative h-4 min-w-0 flex-1">
            <AnimatePresence initial={false}>
              <motion.p
                key={focused?.name ?? "law"}
                initial={reduced ? false : { opacity: 0, y: 5 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -5 }}
                transition={{ duration: reduced ? 0 : 0.22, ease: "easeOut" }}
                className="absolute inset-0 truncate text-right text-[11px] leading-none text-fd-muted-foreground"
              >
                {focused ? (
                  <>
                    <span className="text-fd-foreground">{focused.name}</span> replaces{" "}
                    {focused.replaces}
                  </>
                ) : (
                  "irreducible physics only"
                )}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        <div className="relative mt-2 h-5">
          <AnimatePresence initial={false}>
            <motion.div
              key={focused?.name ?? "idle"}
              initial={reduced ? false : { opacity: 0, y: 5 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -5 }}
              transition={{ duration: reduced ? 0 : 0.22, ease: "easeOut" }}
              className="absolute inset-0 flex items-center justify-between gap-3"
            >
              {focused ? (
                <>
                  <Link
                    href={focused.href}
                    className="shrink-0 font-mono text-[13px] leading-none underline-offset-2 hover:underline"
                    style={{ color: elementToneVar(focused.preview) }}
                  >
                    docs/elements/{focused.preview}
                  </Link>
                  <p className="min-w-0 truncate text-right text-xs leading-none text-fd-muted-foreground">
                    {focused.description}
                  </p>
                </>
              ) : (
                <p className="text-xs leading-none text-fd-muted-foreground">
                  New infrastructure is a driver — never a ninth element.
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  );
}
