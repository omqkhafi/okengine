/**
 * Access diagrams for the query-console Gate cards.
 *
 * Each figure is the RLS plane (hatched table) plus who may cross it:
 * Operator passes through, public never enters, As crosses at a Gate.
 */

import { useId, type JSX } from "react";
import { cn } from "@/lib/utils.ts";
import type { QueryGateMode } from "../lib/query-gate.ts";

/** Props for {@link QueryGateViz}. */
export interface QueryGateVizProps {
  readonly mode: QueryGateMode;
  readonly active: boolean;
  /** Extra classes on the SVG (size defaults to `h-10 w-full`). */
  readonly className?: string;
}

/**
 * Compact access diagram for one Gate card.
 *
 * @param props - Card mode + selected state
 */
export function QueryGateViz({ mode, active, className }: QueryGateVizProps): JSX.Element {
  const uid = useId().replace(/:/g, "");
  const hatchId = `${uid}-hatch`;
  const tone = active ? "text-foreground" : "text-muted-foreground/70";

  return (
    <svg
      viewBox="0 0 72 40"
      className={cn("h-10 w-full", tone, className)}
      aria-hidden
      data-slot="store-query-gate-viz"
      data-mode={mode}
    >
      <defs>
        <pattern
          id={hatchId}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <path d="M0 0 H4" className="stroke-current" strokeWidth="0.7" opacity="0.35" />
        </pattern>
      </defs>
      {mode === "operator" ? <OperatorFigure hatchId={hatchId} /> : null}
      {mode === "public" ? <PublicFigure hatchId={hatchId} /> : null}
      {mode === "as" ? <AsFigure hatchId={hatchId} /> : null}
    </svg>
  );
}

function TableBody({ hatchId }: { readonly hatchId: string }): JSX.Element {
  return (
    <>
      <rect
        x="22"
        y="10"
        width="28"
        height="20"
        rx="5"
        fill={`url(#${hatchId})`}
        className="stroke-current"
        strokeWidth="1.15"
      />
      <path d="M22 17 H50" className="stroke-current" strokeWidth="0.8" opacity="0.45" />
    </>
  );
}

function OperatorFigure({ hatchId }: { readonly hatchId: string }): JSX.Element {
  return (
    <g>
      <path
        d="M4 14 C18 14, 18 26, 68 26"
        fill="none"
        className="stroke-sky-500 dark:stroke-sky-400"
        strokeWidth="1.35"
        strokeDasharray="2.4 2"
      />
      <path
        d="M4 26 C18 26, 18 14, 68 14"
        fill="none"
        className="stroke-sky-500 dark:stroke-sky-400"
        strokeWidth="1.35"
        strokeDasharray="2.4 2"
      />
      <TableBody hatchId={hatchId} />
    </g>
  );
}

function PublicFigure({ hatchId }: { readonly hatchId: string }): JSX.Element {
  return (
    <g>
      <path
        d="M4 14 H18"
        fill="none"
        className="stroke-current"
        strokeWidth="1.2"
        strokeDasharray="2.4 2"
        opacity="0.55"
      />
      <path
        d="M4 26 H18"
        fill="none"
        className="stroke-current"
        strokeWidth="1.2"
        strokeDasharray="2.4 2"
        opacity="0.55"
      />
      <TableBody hatchId={hatchId} />
      <path
        d="M54 14 H68"
        fill="none"
        className="stroke-current"
        strokeWidth="1.2"
        strokeDasharray="2.4 2"
        opacity="0.28"
      />
      <path
        d="M54 26 H68"
        fill="none"
        className="stroke-current"
        strokeWidth="1.2"
        strokeDasharray="2.4 2"
        opacity="0.28"
      />
    </g>
  );
}

function AsFigure({ hatchId }: { readonly hatchId: string }): JSX.Element {
  return (
    <g>
      <circle cx="10" cy="16" r="3.1" className="fill-violet-500 dark:fill-violet-400" />
      <path
        d="M5.5 26 C5.5 22.2, 14.5 22.2, 14.5 26"
        fill="none"
        className="stroke-violet-500 dark:stroke-violet-400"
        strokeWidth="1.2"
      />
      <path
        d="M16 20 H22"
        fill="none"
        className="stroke-violet-500 dark:stroke-violet-400"
        strokeWidth="1.25"
      />
      <TableBody hatchId={hatchId} />
      <path
        d="M50 20 H56"
        fill="none"
        className="stroke-violet-500 dark:stroke-violet-400"
        strokeWidth="1.25"
      />
      <path
        d="M59 13.5 L64.5 17 L59 26.5 L53.5 17 Z"
        className="fill-background stroke-violet-500 dark:stroke-violet-400"
        strokeWidth="1.15"
      />
    </g>
  );
}
