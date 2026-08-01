/**
 * Proof strip — count-up numbers backing the readme pitch. Counts run once
 * on first scroll into view; reduced motion prints the final values.
 * Every figure is a real count from the framework or a measured CI budget.
 */

"use client";

import { animate, motion, useInView, useMotionValue, useTransform } from "framer-motion";
import { Boxes, Cpu, Package, Timer, Workflow, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { budgetById, bytesToKb } from "@/lib/budgets";
import { cn } from "@/lib/cn";
import { ELEMENTS, EXPORTS, ZOO_CONCERNS } from "@/lib/elements";
import { CHIP_TONE, type ElementChipTone } from "@/lib/element-tones";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

type Stat = {
  readonly value: number;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly decimals?: number;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly tone: ElementChipTone;
};

const kernel = budgetById("kernelEdgeGzipBytes");
const coldStart = budgetById("coldStartMedianMs");

const STATS: ReadonlyArray<Stat> = [
  { value: ELEMENTS.length, label: "elements, closed set", icon: Workflow, tone: "sky" },
  { value: EXPORTS.length, label: "exports, one import", icon: Package, tone: "cyan" },
  { value: ZOO_CONCERNS.length, label: "zoo concerns collapsed", icon: Boxes, tone: "amber" },
  {
    value: bytesToKb(kernel.value),
    decimals: 2,
    suffix: " kB",
    label: "kernel edge · gzip measured",
    icon: Cpu,
    tone: "teal",
  },
  {
    value: Math.round(coldStart.value),
    suffix: " ms",
    label: "cold start on Bun · measured",
    icon: Timer,
    tone: "orange",
  },
];

/**
 * One animated figure. Renders through a MotionValue so the count never
 * re-renders React per frame.
 */
function StatNumber({ stat }: { readonly stat: Stat }): ReactNode {
  const reduced = useClientReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const value = useMotionValue(reduced ? stat.value : 0);
  const decimals = stat.decimals ?? 0;
  const text = useTransform(value, (current) => {
    const n = decimals > 0 ? current.toFixed(decimals) : String(Math.round(current));
    return `${stat.prefix ?? ""}${n}${stat.suffix ?? ""}`;
  });

  useEffect(() => {
    if (!inView || reduced) return;
    const controls = animate(value, stat.value, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [inView, reduced, stat.value, value]);

  return <motion.span ref={ref}>{text}</motion.span>;
}

/**
 * Stat row for the readme band — five measured / exact counts.
 */
export function ProofStrip(): ReactNode {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
      {STATS.map((stat) => {
        const Icon = stat.icon;
        const tone = CHIP_TONE[stat.tone];
        return (
          <div
            key={stat.label}
            className="flex flex-col gap-1.5 sm:border-l sm:border-fd-border sm:pl-5 sm:first:border-0 sm:first:pl-0"
          >
            <dt className="order-2 flex items-center gap-1.5 font-mono text-[11px] leading-snug tracking-[0.1em] text-fd-muted-foreground uppercase">
              <Icon aria-hidden className={cn("size-3 shrink-0", tone.icon)} strokeWidth={1.75} />
              {stat.label}
            </dt>
            <dd className="order-1 font-mono text-2xl tracking-tight text-fd-foreground tabular-nums sm:text-[1.7rem]">
              <StatNumber stat={stat} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
