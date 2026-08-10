/**
 * Collapse board — the compact, docs-side telling of the integration curve.
 *
 * The landing page carries the full stepped CollapseDiagram with both rings
 * side by side; docs get one look instead: the same forty concerns on the
 * same ring twice. Left, the zoo — every seam drawn, 136 of them. Right, the
 * collapse — each concern spoked to its element, each element trunked once to
 * the law, 48 edges.
 *
 * One live beat carries the argument: a change feed picks a concern
 * (deterministic hash, never Math.random — the server renders beat zero too)
 * and both panels cost that same change. The zoo lights every seam it has to
 * re-check; the hub lights one spoke and one trunk. The readout underneath
 * says the two numbers. Reduced motion holds the finished, unlit graph.
 *
 * SVG note: colours are presentation attributes bound to theme variables and
 * soft `--oke-el-*` inks, never Tailwind `fill-*` / `stroke-*` utilities —
 * they are not part of the Fumadocs preset build.
 */

"use client";

import { motion } from "framer-motion";
import { ArrowDown, ArrowRight } from "lucide-react";
import { useTick } from "@/components/docs/reveal";
import { ELEMENTS, ZOO_CONCERNS } from "@/lib/elements";
import { toneForElementName } from "@/lib/element-tones";
import {
  TREE_CHANGE_COST,
  treeEdgeCount,
  ZOO_SEAM_PAIRS,
  zooBusiest,
  zooDegree,
  zooSeamCount,
} from "@/lib/zoo-graph";

const TOTAL = ZOO_CONCERNS.length;
const SEAM_TOTAL = zooSeamCount(TOTAL);
const EDGE_TOTAL = treeEdgeCount(TOTAL);
const BUSIEST = zooBusiest(TOTAL);

/* Compact elliptical geometry — concerns outer, elements inner, law centred. */
const W = 180;
const H = 148;
const CX = W / 2;
const CY = H / 2 + 2;
const RING_RX = 78;
const RING_RY = 55;
const EL_RX = 44;
const EL_RY = 29;
const EL_R = 8;
const HUB_R = 6.5;

const TICK_MS = 1400;

/** Two decimals — server and browser `Math.cos` disagree in the last bits. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Angle in degrees for ring slot `i`, starting at twelve o'clock. */
function angleAt(i: number): number {
  return -90 + (i * 360) / TOTAL;
}

/** Point on an ellipse at `angle` (degrees). */
function pointAt(
  rx: number,
  ry: number,
  angle: number,
): { readonly x: number; readonly y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: round(CX + rx * Math.cos(rad)), y: round(CY + ry * Math.sin(rad)) };
}

const CONCERNS = ZOO_CONCERNS.map((concern, i) => ({
  label: concern.label,
  element: concern.element,
  ...pointAt(RING_RX, RING_RY, angleAt(i)),
}));

/** Elements sit at the mean angle of the concerns they subsume. */
const ELEMENT_NODES = ELEMENTS.filter((element) =>
  CONCERNS.some((concern) => concern.element === element.name),
).map((element) => {
  const owned = CONCERNS.map((concern, i) => ({ concern, i })).filter(
    (entry) => entry.concern.element === element.name,
  );
  const angle = angleAt(Math.round(owned.reduce((sum, entry) => sum + entry.i, 0) / owned.length));
  return {
    name: element.name,
    symbol: element.symbol,
    concerns: owned.map((entry) => entry.i),
    ...pointAt(EL_RX, EL_RY, angle),
  };
});

const SEAM_LINES = ZOO_SEAM_PAIRS.map((seam) => ({
  key: seam.key,
  a: seam.a,
  b: seam.b,
  x1: CONCERNS[seam.a]!.x,
  y1: CONCERNS[seam.a]!.y,
  x2: CONCERNS[seam.b]!.x,
  y2: CONCERNS[seam.b]!.y,
}));

/**
 * A 32-bit integer mix — the feed's whole source of surprise, and the same
 * answer on the server as in the browser (see CollapseDiagram).
 *
 * @param value - Beat index
 */
function mix32(value: number): number {
  let x = (value + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

/**
 * The collapse in one look: 40 concerns, 136 seams → 8 elements, 48 edges.
 */
export function CollapseBoard() {
  const tick = useTick(TICK_MS);
  const reduced = tick === null;
  const changed = reduced ? -1 : mix32(tick ?? 0) % TOTAL;
  const concern = changed >= 0 ? CONCERNS[changed] : null;
  const element = concern ? ELEMENT_NODES.find((node) => node.name === concern.element) : null;
  const litTone = concern ? toneForElementName(concern.element) : "var(--color-fd-foreground)";

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label={`The collapse: ${TOTAL} infrastructure concerns wired into ${SEAM_TOTAL} hand-maintained seams on the left, collapsed onto eight elements bound once to the law on the right — ${EDGE_TOTAL} edges. One change costs up to ${BUSIEST.seams} seams in the zoo and always ${TREE_CHANGE_COST} edges in okengine.`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">The collapse, in one look</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          {SEAM_TOTAL} seams → {EDGE_TOTAL} edges
        </code>
      </div>

      <div className="grid grid-cols-1 gap-px bg-fd-border @min-[34rem]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        {/* The zoo: every concern, every seam you keep in sync by hand. */}
        <div className="flex min-w-0 flex-col gap-1.5 bg-fd-card px-4 py-3 sm:px-5">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="mx-auto w-full max-w-56"
            role="img"
            aria-label={`The zoo: ${TOTAL} concerns with ${SEAM_TOTAL} seams between them`}
          >
            <g
              stroke="var(--color-fd-muted-foreground)"
              strokeWidth="0.5"
              strokeDasharray="2 3"
              opacity="0.13"
              fill="none"
            >
              {SEAM_LINES.map((line) => (
                <line key={line.key} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
              ))}
            </g>
            {concern
              ? SEAM_LINES.filter((line) => line.a === changed || line.b === changed).map(
                  (line) => (
                    <line
                      key={`lit-${line.key}`}
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                      stroke={litTone}
                      strokeWidth="1"
                      opacity="0.75"
                    />
                  ),
                )
              : null}
            {CONCERNS.map((node, i) => (
              <circle
                key={node.label}
                cx={node.x}
                cy={node.y}
                r={i === changed ? 3 : 1.8}
                fill={i === changed ? litTone : "var(--color-fd-muted-foreground)"}
                style={{ transition: "fill 240ms ease" }}
              />
            ))}
          </svg>
          <p className="flex items-baseline justify-center gap-2 font-mono text-[10px] text-fd-muted-foreground">
            <span className="tracking-[0.14em] uppercase">the zoo</span>
            <span className="text-fd-foreground tabular-nums">{TOTAL} concerns</span>
            <span aria-hidden>·</span>
            <span className="text-fd-foreground tabular-nums">{SEAM_TOTAL} seams</span>
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 bg-fd-card px-4 py-2 @min-[34rem]:flex-col @min-[34rem]:px-3">
          <ArrowDown
            className="size-3.5 text-fd-muted-foreground/70 @min-[34rem]:hidden"
            aria-hidden
          />
          <ArrowRight
            className="hidden size-3.5 text-fd-muted-foreground/70 @min-[34rem]:block"
            aria-hidden
          />
          <span className="font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground uppercase">
            collapse
          </span>
        </div>

        {/* okengine: every concern spoked to its element, trunked to the law. */}
        <div className="flex min-w-0 flex-col gap-1.5 bg-fd-card px-4 py-3 sm:px-5">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="mx-auto w-full max-w-56"
            role="img"
            aria-label={`okengine: the same ${TOTAL} concerns collapsed onto eight elements bound to the law — ${EDGE_TOTAL} edges`}
          >
            <g fill="none">
              {CONCERNS.map((node, i) => {
                const owner = ELEMENT_NODES.find((entry) => entry.name === node.element)!;
                const lit = i === changed;
                return (
                  <line
                    key={`spoke-${node.label}`}
                    x1={node.x}
                    y1={node.y}
                    x2={owner.x}
                    y2={owner.y}
                    stroke={lit ? litTone : "var(--color-fd-muted-foreground)"}
                    strokeWidth={lit ? 1.2 : 0.6}
                    opacity={lit ? 0.9 : 0.3}
                    style={{ transition: "stroke 240ms ease, opacity 240ms ease" }}
                  />
                );
              })}
              {ELEMENT_NODES.map((node) => {
                const lit = element?.name === node.name;
                return (
                  <line
                    key={`trunk-${node.name}`}
                    x1={node.x}
                    y1={node.y}
                    x2={CX}
                    y2={CY}
                    stroke={lit ? litTone : "var(--color-fd-muted-foreground)"}
                    strokeWidth={lit ? 1.4 : 0.8}
                    opacity={lit ? 0.95 : 0.5}
                    style={{ transition: "stroke 240ms ease, opacity 240ms ease" }}
                  />
                );
              })}
            </g>
            <motion.circle
              key={reduced ? "hub" : `hub-${tick}`}
              cx={CX}
              cy={CY}
              fill="var(--color-fd-background)"
              stroke="var(--color-fd-foreground)"
              strokeWidth="1"
              initial={false}
              animate={
                reduced || !concern
                  ? { r: HUB_R, strokeOpacity: 0.45 }
                  : { r: [HUB_R, HUB_R + 2, HUB_R], strokeOpacity: [0.45, 0.9, 0.45] }
              }
              transition={reduced ? { duration: 0 } : { duration: 0.8, ease: "easeOut" }}
            />
            {ELEMENT_NODES.map((node) => {
              const lit = element?.name === node.name;
              const tone = toneForElementName(node.name);
              return (
                <g key={node.name}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={EL_R}
                    fill={
                      lit
                        ? `color-mix(in oklch, ${tone} 18%, var(--color-fd-secondary))`
                        : "var(--color-fd-secondary)"
                    }
                    stroke={lit ? tone : "var(--color-fd-border)"}
                    strokeWidth="1"
                    style={{ transition: "fill 240ms ease, stroke 240ms ease" }}
                  />
                  <text
                    x={node.x}
                    y={node.y + 2.5}
                    textAnchor="middle"
                    fontSize="7"
                    fontFamily="var(--font-mono, ui-monospace, monospace)"
                    fill={lit ? tone : "var(--color-fd-foreground)"}
                    style={{ transition: "fill 240ms ease" }}
                  >
                    {node.symbol}
                  </text>
                </g>
              );
            })}
            {CONCERNS.map((node, i) => (
              <circle
                key={node.label}
                cx={node.x}
                cy={node.y}
                r={i === changed ? 3 : 1.8}
                fill={i === changed ? litTone : "var(--color-fd-muted-foreground)"}
                style={{ transition: "fill 240ms ease" }}
              />
            ))}
          </svg>
          <p className="flex items-baseline justify-center gap-2 font-mono text-[10px] text-fd-muted-foreground">
            <span className="tracking-[0.14em] uppercase">okengine</span>
            <span className="text-fd-foreground tabular-nums">8 elements</span>
            <span aria-hidden>·</span>
            <span className="text-fd-foreground tabular-nums">{EDGE_TOTAL} edges</span>
          </p>
        </div>
      </div>

      {/* One change, two costs — the live beat both panels are lighting. */}
      <div className="flex min-h-9 flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5 border-t border-fd-border px-4 py-2 sm:px-5">
        {concern ? (
          <p className="font-mono text-[11px] text-fd-muted-foreground" aria-hidden>
            <span className="text-fd-foreground">change {concern.label}</span>
            {" — zoo re-checks "}
            <span className="text-fd-foreground tabular-nums">{zooDegree(changed, TOTAL)}</span>
            {" seams · hub re-checks "}
            <span className="text-fd-foreground tabular-nums">{TREE_CHANGE_COST}</span>
            {" edges"}
          </p>
        ) : (
          <p className="font-mono text-[11px] text-fd-muted-foreground">
            one change costs up to {BUSIEST.seams} seams in the zoo — here it is always{" "}
            {TREE_CHANGE_COST} edges
          </p>
        )}
      </div>
    </figure>
  );
}
