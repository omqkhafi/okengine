/**
 * Collapse diagram — the integration curve, stepped one element's worth of
 * concerns at a time.
 *
 * Both shapes add the same concerns in the same order: every concern the §5
 * table says the eight elements replace, all forty of them. In "the zoo" a
 * concern lands on the several concerns already present that it genuinely has
 * to know about — the curated seams in `lib/zoo-graph.ts`, not a complete
 * graph — so the seams you own outgrow the concerns you added. In "okengine" a
 * concern attaches to its element and the element is bound once to the law, so
 * one spoke arrives and the trunk is already there. Both rings sit side by
 * side on one shared step index — the argument is the contrast, not a tab
 * flip — and every number on screen is counted from the seam data rather than
 * from a formula.
 *
 * Pacing: one step per element, eight in all, which is the argument's own unit
 * — the zoo takes on a cluster of concerns while the hub side takes on exactly
 * one trunk. It ramps from a fast early step to a slower late one, about three
 * seconds in total. The controls drive the same step index, so `step N / M` and
 * the captions stay exact whatever the pacing.
 *
 * Readability: forty labelled nodes do not fit a 420 viewBox at the 11.5px
 * floor this project holds SVG text to — the ring would need a radius of about
 * 500 before adjacent labels near twelve o'clock stopped overlapping, and the
 * text would then render at four real pixels. So the nodes are points; the ring
 * carries one labelled arc per element (the eight groups); and the live chips
 * name the active source plus a short fan of its destinations (A → B, C, D),
 * clamped into the viewBox. Nothing is lost to a screen reader — every node's
 * `aria-label` still enumerates its seams by name, and the panel labels
 * enumerate all forty concerns.
 *
 * Two live layers carry the argument without the user touching anything.
 * Hovering any node lights only its own seams — two to fifteen of them in the
 * zoo, always two here — on both rings at once. While idle, a change feed jumps
 * around the ring: each beat lights a small real-world operation — a few
 * concerns on different elements at once — and costs that bundle in both
 * shapes. The jump is a deterministic hash of the beat index, never
 * `Math.random`: the server renders beat zero too, and a different pick in the
 * browser is a hydration mismatch.
 *
 * Concept inspired by stepped "problem space" diagrams common on backend
 * framework marketing sites (see site/NOTICE); geometry, markup, interaction,
 * and copy are written from scratch here.
 *
 * Motion note: each kind of value gets the transition that suits it — springs
 * for anything that changes size, so an arriving node has weight; a long ease
 * for edges, which do not fade in but *grow out of* the node that just arrived,
 * staggered within the arriving arc so a step reads as a fan. The travelling
 * dash of a change is CSS (`stroke-dashoffset` on a path with SVG
 * `pathLength={1}`), not Framer — `pathOffset` left a frozen fleck on the lit
 * seams.
 *
 * Performance note: the mesh is 136 lines. Drawn the way the rest of the
 * diagram is — one `motion.line` per seam, with the hover state in `animate` —
 * it is smooth on this machine and not on a slower one: sweeping the pointer
 * across all forty nodes measured a 17.6 ms p95 unthrottled but 83.5 ms with
 * the CPU throttled 4×, because every pointer move re-rendered 136 Framer
 * components and handed each of them fresh values. So the mesh alone is plain
 * SVG: `SeamMesh` is memoised on the step and knows nothing about the pointer,
 * a hover dims it with one style write on its wrapper, and the light is a
 * separate overlay of at most fifteen lines. That took the same 4× sweep to a
 * 50 ms p95 in dev and 34 ms in a production build. Everything else — nodes,
 * spokes, trunks, traces, the counter — is still Framer, which is comfortable
 * at those counts.
 *
 * SVG note: colours and sizes are presentation attributes bound to Fumadocs
 * theme variables (and soft `--oke-el-*` element inks), never Tailwind
 * `fill-*` / `stroke-*` / `text-[Npx]` utilities — the neutral palette
 * utilities are not part of the Fumadocs preset build, so utility-driven SVG
 * fills silently fall back to `fill: #000` and default 16px text. Colours also
 * stay presentation attributes rather than animated values: an animated colour
 * resolves the theme variable to a fixed rgb and would then survive a theme
 * switch as an inline style.
 */

"use client";

import { animate, motion, MotionConfig, useMotionValue, useTransform } from "framer-motion";
import type { Transition } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { memo, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { OkeLogo } from "@/components/oke-logo";
import { cn } from "@/lib/cn";
import { ELEMENTS, ZOO_CONCERN_GROUPS, ZOO_CONCERNS } from "@/lib/elements";
import { toneForElementName } from "@/lib/element-tones";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";
import {
  TREE_CHANGE_COST,
  treeEdgeCount,
  ZOO_SEAM_PAIRS,
  zooBusiest,
  zooDegree,
  zooPassCost,
  zooSeamCount,
  zooSeamsOf,
} from "@/lib/zoo-graph";

const VIEW = 420;
const C = VIEW / 2;
/**
 * Pulled in from the viewBox edge so chips and group names sit in a real outer
 * band — at 152 the longest labels clamped sideways and cut across the ring.
 */
const CONCERN_RING = 118;
/** Arc that brackets each element's cluster, just outside the concern dots. */
const GROUP_ARC_RING = CONCERN_RING + 10;
/**
 * Group names sit outside the arc by more than half a line of type — otherwise
 * the stroke cuts through "Channel" / "Vault" / "Store".
 */
const GROUP_LABEL_RING = GROUP_ARC_RING + 16;
/** Preferred radius for concern chips — well clear of the group-name band. */
const CHIP_RING = GROUP_LABEL_RING + 32;
const ELEMENT_RING = 72;
const ELEMENT_R = 13;
const HUB_R = 32;
/**
 * Destination chips drawn with the active source. The busiest zoo node owns
 * fifteen seams; four named ends keep the fan readable beside the readout.
 */
const MAX_DEST_LABELS = 4;
/** Wordmark size inside the law hub (viewBox units; aspect matches OkeLogo). */
const HUB_LOGO_W = 50;
const HUB_LOGO_H = (HUB_LOGO_W * 87) / 327;

/** Every concern the eight elements replace. */
const TOTAL = ZOO_CONCERNS.length;

/**
 * One blank ring slot between each element's arc and the next, so forty points
 * read as eight clusters rather than one undifferentiated dotted circle.
 */
const ARC_GAP_SLOTS = 1;
const RING_SLOTS = TOTAL + ZOO_CONCERN_GROUPS.length * ARC_GAP_SLOTS;

/**
 * A step adds one element's concerns. Eight steps, which is the argument's own
 * unit: the zoo takes on a cluster, the hub side takes on one trunk.
 */
const LAST_STEP = ZOO_CONCERN_GROUPS.length - 1;

/** Dwell on the first step, and on the last: the pass ramps between them. */
const STEP_MIN_MS = 250;
const STEP_MAX_MS = 650;

/** Change-feed period: one small multi-concern operation per beat. */
const BEAT_MS = 1400;

/** One lap of the travelling dash along a lit seam. */
const TRACE_MS = 650;

/** Seams of the changed concerns that carry a travelling dash, not just a glow. */
const BEAT_LANES = 4;

/**
 * Concerns lit together each beat — enough to read as traffic across elements,
 * few enough that the chips still fit the outer band.
 */
const BEAT_OPS = 3;

/** Anything that changes size arrives with weight. */
const NODE: Transition = { type: "spring", stiffness: 320, damping: 26, mass: 0.6 };

/** Edges grow rather than fade, so they need a long, decelerating ease. */
const DRAW_MS = 500;
const DRAW_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const DRAW: Transition = { duration: DRAW_MS / 1000, ease: [0.22, 1, 0.36, 1] };

/** Lighting, dimming, and crossfades. */
const FADE: Transition = { duration: 0.28, ease: "easeOut" };

/** Reduced motion keeps every state, and takes none of the time. */
const INSTANT: Transition = { duration: 0 };

/** Per-hop delay, in ms, of the wave that spreads out from a changed concern. */
const WAVE_MS = 15;

/** Per-edge delay, in ms, of the fan a newly arrived arc throws out. */
const FAN_MS = 30;

/** Head start a spoke gets over the trunk that carries it to the law. */
const SPOKE_LEAD_S = 0.12;

/**
 * Presentation attributes take part in the cascade, so a plain CSS transition
 * is all a fill or stroke swap needs — and it leaves the colour in the theme's
 * hands rather than in an inline rgb.
 */
const TINT: CSSProperties = { transition: "fill 240ms ease, stroke 240ms ease" };

type Point = { readonly x: number; readonly y: number };

/**
 * The transition a radius should use to reach `target`.
 *
 * `NODE` is underdamped, which is what gives an arriving node its weight — but
 * a radius springing down to zero overshoots past it, and the browser rejects a
 * negative `r` outright. A circle on its way out therefore eases instead.
 *
 * @param target - Radius the circle is animating to
 * @param grow - Transition for a circle that is arriving or resizing
 * @param shrink - Transition for a circle that is leaving
 */
function radius(target: number, grow: Transition, shrink: Transition): Transition {
  return target === 0 ? shrink : grow;
}

/**
 * Two decimals, because `Math.cos` disagrees with itself in the last bits
 * between the server runtime and the browser, and React reports that as a
 * hydration mismatch on every coordinate it touches.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Angle in degrees for ring `slot`, starting at twelve o'clock. Slots, not
 * concerns: the blank ones between arcs are what separate the eight clusters.
 */
function angleAt(slot: number): number {
  return -90 + (slot * 360) / RING_SLOTS;
}

/** Cartesian point at `radius` along `angle` (degrees) from the diagram centre. */
function pointAt(radius: number, angle: number): Point {
  const rad = (angle * Math.PI) / 180;
  return { x: round(C + radius * Math.cos(rad)), y: round(C + radius * Math.sin(rad)) };
}

/**
 * SVG arc along `radius` from `startAngle` to `endAngle` (degrees).
 *
 * @param radius - Distance from the diagram centre
 * @param startAngle - Arc start, degrees
 * @param endAngle - Arc end, degrees
 * @param clockwise - Sweep flag: the same direction `angleAt` walks the ring.
 *   Flipped label paths go anticlockwise so bottom-half names stay upright —
 *   without it a reversed span normalises to ~330° and the text rides the
 *   whole ring onto its neighbours.
 */
function arcPath(radius: number, startAngle: number, endAngle: number, clockwise = true): string {
  const start = pointAt(radius, startAngle);
  const end = pointAt(radius, endAngle);
  let sweep = clockwise ? endAngle - startAngle : startAngle - endAngle;
  if (sweep < 0) sweep += 360;
  const large = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} ${clockwise ? 1 : 0} ${end.x} ${end.y}`;
}

/** Where a ray leaving the centre at `angle` meets the hub circle. */
function hubDock(angle: number): Point {
  return pointAt(HUB_R, angle);
}

/** Group index of every concern, so a lookup does not scan the eight arcs. */
const GROUP_OF: ReadonlyArray<number> = ZOO_CONCERNS.map((_, index) =>
  ZOO_CONCERN_GROUPS.findIndex((group) => index >= group.start && index < group.end),
);

const CONCERNS = ZOO_CONCERNS.map((concern, i) => {
  const group = GROUP_OF[i]!;
  const angle = angleAt(i + group * ARC_GAP_SLOTS);
  return {
    text: concern.label,
    element: concern.element,
    group,
    angle,
    node: pointAt(CONCERN_RING, angle),
    /** Preferred chip seat on the outward ray — placement may step in radially. */
    labelPoint: pointAt(CHIP_RING, angle),
  };
});

/**
 * One labelled arc per element: the blank gap slots already break the ring into
 * eight clusters; these arcs and names make that grouping legible without
 * crowding the concern dots. The name rides the arc on a `textPath`, so
 * "Vault" and "Channel" curve with their cluster instead of cutting across it.
 */
const GROUP_ARCS = ZOO_CONCERN_GROUPS.map((group, gi) => {
  const firstSlot = group.start + gi * ARC_GAP_SLOTS;
  const lastSlot = group.end - 1 + gi * ARC_GAP_SLOTS;
  const startAngle = angleAt(firstSlot - ARC_GAP_SLOTS * 0.35);
  const endAngle = angleAt(lastSlot + ARC_GAP_SLOTS * 0.35);
  const midAngle = angleAt((firstSlot + lastSlot) / 2);
  /**
   * Flip every name whose arc sits below the horizontal midline (screen
   * angles run 0° east → 180° west through the bottom): clockwise text past
   * the midline rides more upside-down than upright, so "Store", "Clock",
   * "Gate", and "Vault" run the other way while "Channel" and "AI" do not.
   */
  const midRad = ((midAngle % 360) + 360) % 360;
  const bottomHalf = midRad > 0 && midRad < 180;
  return {
    element: group.element,
    start: group.start,
    end: group.end,
    id: `group-arc-${group.element.toLowerCase().replace(/[^a-z]/g, "")}`,
    path: arcPath(GROUP_ARC_RING, startAngle, endAngle),
    textPath: bottomHalf
      ? arcPath(GROUP_LABEL_RING, endAngle, startAngle, false)
      : arcPath(GROUP_LABEL_RING, startAngle, endAngle),
  };
});

/**
 * Elements sit at the mean angle of the concerns they subsume, so the collapse
 * reads as a fan rather than a tangle of chords.
 */
const ELEMENT_NODES = ELEMENTS.filter((element) =>
  CONCERNS.some((concern) => concern.element === element.name),
).map((element) => {
  const owned = CONCERNS.map((concern, i) => ({ concern, i })).filter(
    (entry) => entry.concern.element === element.name,
  );
  const angle = owned.reduce((sum, entry) => sum + entry.concern.angle, 0) / owned.length;
  return {
    name: element.name,
    symbol: element.symbol,
    angle,
    node: pointAt(ELEMENT_RING, angle),
    /** Where this element's trunk docks against the hub. */
    dock: hubDock(angle),
    /** Preferred chip seat on the outward ray — placement may step in radially. */
    labelPoint: pointAt(ELEMENT_RING + 32, angle),
    /** Concern indices this element subsumes, in ring order. */
    concerns: owned.map((entry) => entry.i),
    /** Index of the first concern that brings this element into the graph. */
    firstConcern: Math.min(...owned.map((entry) => entry.i)),
  };
});

/**
 * The curated seams, given ring coordinates, plus the polar form the mesh grows
 * along. `b` is the later arrival, so the seam is measured *from* `b`: a line
 * laid along its own x axis and scaled from nothing to full length appears to
 * grow out of the node that just arrived.
 */
const SEAM_EDGES = ZOO_SEAM_PAIRS.map((seam) => {
  const from = CONCERNS[seam.b]!.node;
  const to = CONCERNS[seam.a]!.node;
  return {
    ...seam,
    x1: to.x,
    y1: to.y,
    x2: from.x,
    y2: from.y,
    /** Origin of the growth: the concern that arrives later. */
    ox: from.x,
    oy: from.y,
    length: round(Math.hypot(to.x - from.x, to.y - from.y)),
    angle: round((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI),
  };
});

/** The element arc a step brings in. */
function groupAt(step: number) {
  return ZOO_CONCERN_GROUPS[Math.min(Math.max(step, 0), LAST_STEP)]!;
}

/** Concerns present at `step` — every arc up to and including this step's. */
function visibleCount(step: number): number {
  return groupAt(step).end;
}

/** Labels of the concerns the arc at `step` brings in. */
function groupLabels(step: number): ReadonlyArray<string> {
  const group = groupAt(step);
  return CONCERNS.slice(group.start, group.end).map((concern) => concern.text);
}

/**
 * Dwell on `step`, ramping from `STEP_MIN_MS` to `STEP_MAX_MS` across the pass:
 * the early frames are cheap to read, the late ones are the tangle.
 */
function stepDelay(step: number): number {
  const progress = LAST_STEP === 0 ? 1 : Math.min(1, step / LAST_STEP);
  return Math.round(STEP_MIN_MS + (STEP_MAX_MS - STEP_MIN_MS) * progress);
}

/** Element that subsumes `index`, or undefined if the mapping ever goes stale. */
function elementOf(index: number) {
  return ELEMENT_NODES.find((element) => element.name === CONCERNS[index]!.element);
}

/** Steps around the ring between two concerns, the short way. */
function hopsBetween(from: number, to: number): number {
  const direct = Math.abs(from - to);
  return Math.min(direct, CONCERNS.length - direct);
}

/**
 * A 32-bit integer mix — the shuffle's whole source of surprise.
 *
 * Integer arithmetic only, and no state: `Math.random` or a clock would pick a
 * different concern in the browser than the server put in the HTML, and React
 * reports that as a hydration mismatch on the first paint. The same beat index
 * always yields the same pick, on either side.
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
 * How far back the feed folds to keep its own history straight.
 */
const FEED_WINDOW = 8;

/**
 * Which concerns the feed changes on `tick` — a small operation across distinct
 * elements. A hash rather than `tick % visible`, so the feed reads like change
 * traffic instead of a lap of the ring; the lead pick is folded over a short
 * window so consecutive beats never open on the same concern.
 *
 * Integer arithmetic only: the server renders beat zero too, and a different
 * pick in the browser is a hydration mismatch.
 *
 * @param tick - Beat index since the feed started
 * @param visible - Concerns present at the current step
 */
function changedConcerns(tick: number, visible: number): ReadonlyArray<number> {
  if (visible < 1) return [];
  if (visible === 1) return [0];

  let lead = mix32(tick - FEED_WINDOW) % visible;
  for (let t = tick - FEED_WINDOW + 1; t <= tick; t += 1) {
    const pick = mix32(t) % visible;
    lead = pick === lead ? (pick + 1) % visible : pick;
  }

  const picks: number[] = [lead];
  const usedElements = new Set<string>([CONCERNS[lead]!.element]);
  const want = Math.min(BEAT_OPS, visible);

  for (let attempt = 1; picks.length < want && attempt < visible * 3; attempt += 1) {
    const index = (lead + attempt * (1 + (mix32(tick + attempt * 17) % 7))) % visible;
    const element = CONCERNS[index]!.element;
    if (usedElements.has(element)) continue;
    usedElements.add(element);
    picks.push(index);
  }

  // Not enough distinct elements yet (early steps) — fill with unused indices.
  for (let index = 0; picks.length < want && index < visible; index += 1) {
    if (picks.includes(index)) continue;
    picks.push(index);
  }

  return picks;
}

/** `a, b and c`, for a caption that names the concerns it is counting. */
function listOf(labels: ReadonlyArray<string>): string {
  if (labels.length < 2) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * Labels of the concerns `index` is actually wired to — the other end of each
 * seam it owns, in the order those seams arrived.
 *
 * @param index - Ring position of the concern
 * @param visible - Concerns present at the current step
 */
function wiredTo(index: number, visible: number): ReadonlyArray<string> {
  return zooSeamsOf(index, visible).map(
    (seam) => CONCERNS[seam.a === index ? seam.b : seam.a]!.text,
  );
}

/**
 * Ring positions of the concerns `index` is wired to, capped for on-diagram
 * chips so a fifteen-seam node still reads as A → B, C, D.
 *
 * @param index - Ring position of the source concern
 * @param visible - Concerns present at the current step
 */
function destinationIndices(index: number, visible: number): ReadonlyArray<number> {
  return zooSeamsOf(index, visible)
    .map((seam) => (seam.a === index ? seam.b : seam.a))
    .slice(0, MAX_DEST_LABELS);
}

type TabId = "zoo" | "okengine";

/** Which node the pointer or keyboard focus is on. */
type Hover =
  | { readonly kind: "concern"; readonly index: number }
  | { readonly kind: "element"; readonly name: string };

/** Plural `s` when `count` is not one. */
function s(count: number): string {
  return count === 1 ? "" : "s";
}

/** Live caption naming what the current step just added. */
function captionFor(tab: TabId, step: number): string {
  const group = groupAt(step);
  const visible = group.end;
  const arrived = listOf(groupLabels(step));

  if (tab === "zoo") {
    const total = zooSeamCount(visible);
    if (step === 0) {
      return `${arrived} — ${total} seam${s(total)} between them already.`;
    }
    // Every seam the arc brings is one it has with a concern already there, or
    // with another concern of its own arc.
    const fresh = total - zooSeamCount(group.start);
    return `+ ${arrived} — ${fresh} new seam${s(fresh)} to keep in sync, ${total} in total.`;
  }

  const total = treeEdgeCount(visible);
  const spokes = group.end - group.start;
  if (step === 0) {
    // The hub side opens dearer: every element costs a trunk before it carries
    // anything, and saying so is the whole reason the pass is worth watching.
    const zoo = zooSeamCount(visible);
    const against =
      total > zoo
        ? `more than the ${zoo} the tangle costs so far`
        : total === zoo
          ? "the same as the tangle costs so far"
          : `already fewer than the ${zoo} the tangle costs so far`;
    return `${arrived} collapse onto ${group.element} — ${total} edges, ${against}.`;
  }
  return `+ ${arrived} → ${group.element} — ${spokes} spokes and 1 trunk, ${total} edges in total.`;
}

/** One label/value line of the readout. */
type ReadoutRow = { readonly label: string; readonly value: string };

/** What the shared readout reports: the beat, the hovered node, or the step. */
type Readout = {
  readonly mode: "live" | "hover" | "step";
  readonly progress: string | null;
  readonly rows: ReadonlyArray<ReadoutRow>;
  readonly note: string;
};

/**
 * The shared readout under both rings, in priority order: a hover always wins,
 * then the change feed, then the step that is on screen. Every mode names both
 * costs — that contrast is the whole reason the rings sit side by side.
 *
 * @param visible - Concerns present at the current step
 * @param step - Current step index
 * @param hover - Hovered node, if any
 * @param beat - Current change-feed beat, if the feed is running
 */
function readoutFor(
  visible: number,
  step: number,
  hover: Hover | null,
  beat: Beat | null,
): Readout {
  if (hover?.kind === "element") {
    const element = ELEMENT_NODES.find((node) => node.name === hover.name);
    const owned = (element?.concerns ?? []).filter((index) => index < visible);
    const labels = owned.map((index) => CONCERNS[index]!.text);
    return {
      mode: "hover",
      progress: null,
      rows: [
        { label: "element", value: hover.name },
        { label: "spokes + trunk", value: `${owned.length + 1}` },
        { label: "subsumes", value: labels.join(" · ") },
      ],
      note: `${hover.name} subsumes ${labels.join(" · ")} — ${owned.length} spoke${s(owned.length)} and one trunk to the law.`,
    };
  }

  if (hover?.kind === "concern") {
    const concern = CONCERNS[hover.index]!;
    const zooCost = zooDegree(hover.index, visible);
    // The busiest node owns fifteen seams, and fifteen labels would reflow the
    // strip under the pointer, so the note names a few and counts the rest.
    const named = wiredTo(hover.index, visible);
    const seams =
      named.length > 4
        ? `${listOf(named.slice(0, 3))} and ${named.length - 3} more`
        : listOf(named);
    return {
      mode: "hover",
      progress: null,
      rows: [
        { label: "node", value: concern.text },
        { label: "zoo seams", value: `${zooCost}` },
        { label: "oke edges", value: `${TREE_CHANGE_COST}` },
        {
          label: "wired to",
          value:
            named.length > 3
              ? `${named.slice(0, 3).join(" · ")} +${named.length - 3}`
              : named.join(" · "),
        },
      ],
      note: `${concern.text} is wired to ${seams} — ${zooCost} seam${s(zooCost)} in the zoo, always ${TREE_CHANGE_COST} edges via ${concern.element}.`,
    };
  }

  if (beat) {
    const labels = beat.concerns.map((index) => CONCERNS[index]!.text);
    const zooCost = beat.concerns.reduce((sum, index) => sum + zooDegree(index, visible), 0);
    const hubCost = beat.concerns.length * TREE_CHANGE_COST;
    const busiest = zooBusiest(visible);
    return {
      mode: "live",
      progress: `op ${beat.index + 1}`,
      rows: [
        { label: "changed", value: labels.join(" · ") },
        { label: "zoo re-checks", value: `${zooCost}` },
        { label: "oke re-checks", value: `${hubCost}` },
        { label: "busiest node", value: `${busiest.label} · ${busiest.seams}` },
      ],
      note: `Change ${listOf(labels)} — ${zooCost} seams in the zoo, ${hubCost} edges here.`,
    };
  }

  const group = groupAt(step);
  return {
    mode: "step",
    progress: `step ${step + 1} / ${LAST_STEP + 1}`,
    rows: [
      { label: "added", value: `${group.element} · ${group.end - group.start}` },
      { label: "zoo seams", value: `${zooSeamCount(visible)}` },
      { label: "oke edges", value: `${treeEdgeCount(visible)}` },
      { label: "if each changed once", value: `${zooPassCost(visible)} → ${TREE_CHANGE_COST}` },
    ],
    note: "Hover any node on either ring — both shapes light the same change.",
  };
}

/** One beat of the change feed: the concerns in a small real-world operation. */
type Beat = { readonly index: number; readonly concerns: ReadonlyArray<number> };

/**
 * Seams of the changed concerns that carry a travelling dash, keyed by edge with
 * the lane that phases it.
 *
 * Integer arithmetic only: a `Math.random` or `Math.sin` pick would choose
 * different edges on the server than in the browser, which React reports as a
 * hydration mismatch on the first paint.
 */
function dashedSeams(beat: Beat, visible: number): ReadonlyMap<string, number> {
  const live = new Set(beat.concerns);
  const seams = SEAM_EDGES.filter(
    (edge) => edge.b < visible && (live.has(edge.a) || live.has(edge.b)),
  );
  const lanes = new Map<string, number>();
  for (let lane = 0; lane < BEAT_LANES && lane < seams.length; lane += 1) {
    lanes.set(seams[(beat.index * 5 + lane * 7) % seams.length]!.key, lane);
  }
  return lanes;
}

const PROSE: ReadonlyArray<string> = [
  `All ${TOTAL} concerns the eight elements replace, straight off the unified theory's §5 table — each its own tool, client, and config. An edge is drawn only where two concerns genuinely meet: a credential, an invalidation, an ordering, a delivery.`,
  `That is still ${zooSeamCount(TOTAL)} seams you own on the left — or ${treeEdgeCount(TOTAL)} edges on the right, once every concern belongs to an element bound once to the law. Concern ${TOTAL + 1} adds one edge and no new element; effects stay inferred from what the flow touches through fx.`,
];

/** Each ring owns its own square cell. */
const PANEL_SVG = "size-full";

/** Advance of the mono face at the 11.5px label size, close enough to lay out a chip. */
const LABEL_CHAR = 6.9;
const CHIP_PAD_X = 7;
const CHIP_H = 18;
const CHIP_MARGIN = 4;
/** Gap between the leader trace and the chip edge. */
const ARROW_GAP = 4;
/** Length of the leader's bent end segment, in viewBox units. */
const ELBOW_LEN = 9;
/** Padding between chip boxes when resolving overlaps. */
const CHIP_GAP = 9;
/** Furthest a collision-resolved chip may sit. */
const CHIP_RING_MAX = VIEW / 2 - CHIP_H / 2 - CHIP_MARGIN;

/** Keep `value` inside `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Chip box size for `label` at `emphasis`. */
function chipSize(
  label: string,
  emphasis: "source" | "destination",
): { readonly width: number; readonly height: number } {
  const padX = emphasis === "source" ? CHIP_PAD_X : CHIP_PAD_X - 1;
  const height = emphasis === "source" ? CHIP_H : CHIP_H - 2;
  return { width: label.length * LABEL_CHAR + padX * 2, height };
}

/** Whether two axis-aligned boxes overlap, with `pad` of clearance. */
function boxesOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  pad = CHIP_GAP,
): boolean {
  return !(
    ax + aw / 2 + pad < bx - bw / 2 ||
    bx + bw / 2 + pad < ax - aw / 2 ||
    ay + ah / 2 + pad < by - bh / 2 ||
    by + bh / 2 + pad < ay - ah / 2
  );
}

/**
 * Seat a chip on the ray from the centre at `angle`, preferring `wantR`.
 *
 * Tries the preferred radius, then steps outward (collision resolution), then
 * inward — never slides sideways around the ring.
 *
 * @param angle - Degrees, same convention as `angleAt`
 * @param wantR - Preferred distance from the centre
 * @param width - Chip width
 * @param height - Chip height
 */
function placeOnRay(
  angle: number,
  wantR: number,
  width: number,
  height: number,
): { readonly x: number; readonly y: number; readonly r: number } {
  const minR = GROUP_LABEL_RING + 8;
  const preferred = clamp(wantR, minR, CHIP_RING_MAX);
  const tryR = (
    r: number,
  ): { readonly x: number; readonly y: number; readonly r: number } | null => {
    const point = pointAt(r, angle);
    if (
      point.x - width / 2 >= CHIP_MARGIN &&
      point.x + width / 2 <= VIEW - CHIP_MARGIN &&
      point.y - height / 2 >= CHIP_MARGIN &&
      point.y + height / 2 <= VIEW - CHIP_MARGIN
    ) {
      return { x: point.x, y: point.y, r };
    }
    return null;
  };
  const hit = tryR(preferred);
  if (hit) return hit;
  for (let r = preferred + 2; r <= CHIP_RING_MAX; r += 2) {
    const outward = tryR(r);
    if (outward) return outward;
  }
  for (let r = preferred - 2; r >= minR; r -= 2) {
    const inward = tryR(r);
    if (inward) return inward;
  }
  const fallback = pointAt(minR, angle);
  return { x: fallback.x, y: fallback.y, r: minR };
}

/** One chip to lay out — source or destination. */
type ChipSpec = {
  readonly key: string;
  readonly label: string;
  readonly angle: number;
  readonly emphasis: "source" | "destination";
  readonly tone?: string;
  /** Radius of the node the arrow leaves — concern ring by default. */
  readonly nodeR?: number;
  /** Preferred chip radius — outer band by default. */
  readonly preferR?: number;
};

/** A chip after collision resolution. */
type ChipSeat = ChipSpec & {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly width: number;
  readonly height: number;
  /** Angle used for the arrow (may be nudged off the node ray). */
  readonly drawAngle: number;
  readonly nodeR: number;
};

/**
 * Lay out chips so boxes do not overlap.
 *
 * Sources pin their radius (they are the anchor of the A → B,C,D reading);
 * destinations yield: push outward, then fan a few degrees off the node, and
 * drop a destination that still collides — fewer clear labels beat a stacked
 * pile of `job` / `workflow`.
 *
 * @param specs - Chips to place (source first when present)
 */
function layoutChips(specs: ReadonlyArray<ChipSpec>): ReadonlyArray<ChipSeat> {
  type Working = {
    spec: ChipSpec;
    width: number;
    height: number;
    r: number;
    drawAngle: number;
    x: number;
    y: number;
    keep: boolean;
  };
  const items: Working[] = specs.map((spec) => {
    const size = chipSize(spec.label, spec.emphasis);
    const prefer = spec.preferR ?? CHIP_RING;
    const seat = placeOnRay(spec.angle, prefer, size.width, size.height);
    return {
      spec,
      width: size.width,
      height: size.height,
      r: seat.r,
      drawAngle: spec.angle,
      x: seat.x,
      y: seat.y,
      keep: true,
    };
  });

  const reseat = (item: Working) => {
    const seat = placeOnRay(item.drawAngle, item.r, item.width, item.height);
    item.x = seat.x;
    item.y = seat.y;
    item.r = seat.r;
  };

  /** Preferential victim: a destination; the one that is easier to move. */
  const victimOf = (a: Working, b: Working): Working | null => {
    if (a.spec.emphasis === "source" && b.spec.emphasis === "source") return null;
    if (a.spec.emphasis === "source") return b;
    if (b.spec.emphasis === "source") return a;
    return a.r <= b.r ? a : b;
  };

  for (let pass = 0; pass < 60; pass += 1) {
    let moved = false;
    for (let i = 0; i < items.length; i += 1) {
      const a = items[i]!;
      if (!a.keep) continue;
      for (let j = i + 1; j < items.length; j += 1) {
        const b = items[j]!;
        if (!b.keep) continue;
        if (!boxesOverlap(a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height)) continue;
        const victim = victimOf(a, b);
        if (victim === null) {
          // Two sources — almost never; shove the later one hard outward.
          const other = a.r < b.r ? b : a;
          other.r = Math.min(CHIP_RING_MAX, other.r + 20);
          reseat(other);
          moved = true;
          continue;
        }
        // 1) Radial push.
        if (victim.r + 14 <= CHIP_RING_MAX) {
          victim.r += 14;
          reseat(victim);
          moved = true;
          continue;
        }
        // 2) Fan off the node's ray in widening steps.
        if (Math.abs(victim.drawAngle - victim.spec.angle) < 14) {
          const sign = victim.spec.angle >= (a === victim ? b.spec.angle : a.spec.angle) ? 1 : -1;
          const step = 8 + Math.abs(victim.drawAngle - victim.spec.angle);
          victim.drawAngle = victim.spec.angle + sign * step;
          victim.r = victim.spec.preferR ?? CHIP_RING;
          reseat(victim);
          moved = true;
          continue;
        }
        // 3) No clear seat — drop the destination.
        victim.keep = false;
        moved = true;
      }
    }
    if (!moved) break;
  }

  return items
    .filter((item) => item.keep)
    .map((item) => ({
      ...item.spec,
      x: item.x,
      y: item.y,
      r: item.r,
      width: item.width,
      height: item.height,
      drawAngle: item.drawAngle,
      nodeR: item.spec.nodeR ?? CONCERN_RING,
    }));
}

/**
 * A laid-out label chip with a leader trace from its node toward the box.
 *
 * @param seat - Collision-resolved seat from `layoutChips`
 * @param reduced - Whether the visitor asked for reduced motion
 */
function LabelChip({ seat, reduced }: { readonly seat: ChipSeat; readonly reduced: boolean }) {
  const { label, emphasis, tone, angle, drawAngle, x, y, r, width, height, nodeR } = seat;
  const ink =
    tone ??
    (emphasis === "source" ? "var(--color-fd-foreground)" : "var(--color-fd-muted-foreground)");
  const stroke = tone ?? "var(--color-fd-border)";
  /**
   * The connector leaves its pin on the node's true ray, then breaks square
   * and plugs into the chip edge — the bent leader of a technical drawing,
   * not an arrowhead. The creeping dash rides both segments.
   */
  const pin = pointAt(nodeR + 7, angle);
  const shaftStart = pointAt(nodeR + 9.5, angle);
  const rad = (drawAngle * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  /** Shallow rays break horizontal into a side edge; steep rays break vertical. */
  const horizontal = Math.abs(cosA) >= Math.abs(sinA);
  const end = horizontal
    ? { x: round(x - Math.sign(cosA) * (width / 2 + ARROW_GAP)), y: round(y) }
    : { x: round(x), y: round(y - Math.sign(sinA) * (height / 2 + ARROW_GAP)) };
  const shaftLen = Math.hypot(end.x - shaftStart.x, end.y - shaftStart.y);
  /**
   * The bent end earns its place only on diagonals — a leader that is
   * already axis-aligned stays a clean straight line, and so does one too
   * short to bend without doubling back on itself.
   */
  const collinear = horizontal ? Math.abs(sinA) < 0.21 : Math.abs(cosA) < 0.21;
  const bent = !collinear && shaftLen > ELBOW_LEN + 8;
  const elbow = horizontal
    ? { x: round(end.x - Math.sign(cosA) * ELBOW_LEN), y: end.y }
    : { x: end.x, y: round(end.y - Math.sign(sinA) * ELBOW_LEN) };
  const trace = bent
    ? `M ${shaftStart.x} ${shaftStart.y} L ${elbow.x} ${elbow.y} L ${end.x} ${end.y}`
    : `M ${shaftStart.x} ${shaftStart.y} L ${end.x} ${end.y}`;
  const showArrow = r - nodeR > 18;
  return (
    <motion.g
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: emphasis === "source" ? 1 : 0.92 }}
      transition={reduced ? INSTANT : FADE}
      pointerEvents="none"
      aria-hidden="true"
    >
      {showArrow ? (
        <g opacity={emphasis === "source" ? 0.95 : 0.78} style={reduced ? undefined : TINT}>
          <path
            d={trace}
            fill="none"
            stroke={stroke}
            strokeWidth="0.9"
            opacity="0.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={trace}
            fill="none"
            stroke={stroke}
            strokeWidth={emphasis === "source" ? 1.05 : 0.9}
            strokeDasharray="2.5 4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={reduced ? undefined : "oke-chip-flow"}
          />
          <circle
            cx={pin.x}
            cy={pin.y}
            r="2.1"
            fill="var(--color-fd-background)"
            stroke={stroke}
            strokeWidth="1"
          />
          <circle cx={pin.x} cy={pin.y} r="0.8" fill={stroke} />
        </g>
      ) : null}
      <rect
        x={round(x - width / 2)}
        y={round(y - height / 2)}
        width={round(width)}
        height={height}
        rx="4"
        fill="var(--color-fd-card)"
        stroke={stroke}
        strokeWidth={emphasis === "source" ? 1 : 0.85}
        opacity={emphasis === "source" ? 1 : 0.94}
        style={reduced ? undefined : TINT}
      />
      <text
        x={round(x)}
        y={round(y + 3.5)}
        textAnchor="middle"
        // 11.5 in a 420 viewBox keeps the label above ~8 real px on a 390px
        // screen, the floor this project holds SVG text to.
        fontSize="11.5"
        fontFamily="var(--font-mono, ui-monospace, monospace)"
        fill={ink}
        style={reduced ? undefined : TINT}
      >
        {label}
      </text>
    </motion.g>
  );
}

/**
 * The eight group arcs and their element names — the ring's own legend.
 *
 * When a group's concerns already carry source/destination chips, the name is
 * suppressed so "Store" does not sit among `database` / `cache` as if it were
 * another destination. The arc stays, so the clustering remains visible.
 *
 * @param visible - Concerns present at the current step
 * @param activeElement - Element currently focused by hover (single)
 * @param litElements - Elements lit together by a multi-op beat
 * @param quietElements - Elements whose name would collide with live chips
 * @param reduced - Whether the visitor asked for reduced motion
 */
function GroupBands({
  visible,
  activeElement,
  litElements,
  quietElements,
  reduced,
}: {
  readonly visible: number;
  readonly activeElement: string | null;
  readonly litElements?: ReadonlyArray<string>;
  readonly quietElements?: ReadonlyArray<string>;
  readonly reduced: boolean;
}) {
  const fade = reduced ? INSTANT : FADE;
  const tint = reduced ? undefined : TINT;
  const litSet = new Set(litElements ?? (activeElement === null ? [] : [activeElement]));
  const focusing = litSet.size > 0;
  return (
    <g aria-hidden="true">
      {GROUP_ARCS.map((arc) => {
        const shown = arc.start < visible;
        const lit = litSet.has(arc.element);
        const quiet = quietElements?.includes(arc.element) ?? false;
        const tone = toneForElementName(arc.element);
        return (
          <motion.g
            key={arc.element}
            initial={false}
            animate={{ opacity: shown ? (lit ? 1 : focusing ? 0.45 : 0.85) : 0 }}
            transition={fade}
          >
            <path
              d={arc.path}
              fill="none"
              stroke={lit ? tone : "var(--color-fd-muted-foreground)"}
              strokeWidth={lit ? 1.5 : 1}
              strokeLinecap="round"
              opacity={lit ? 0.9 : 0.55}
              style={tint}
            />
            {quiet ? null : (
              <>
                <defs>
                  <path id={arc.id} d={arc.textPath} fill="none" />
                </defs>
                <text
                  fontSize="11.5"
                  fontFamily="var(--font-mono, ui-monospace, monospace)"
                  fill={lit ? tone : "var(--color-fd-foreground)"}
                  opacity={lit ? 1 : 0.55}
                  style={tint}
                >
                  <textPath href={`#${arc.id}`} startOffset="50%" textAnchor="middle">
                    {arc.element}
                  </textPath>
                </text>
              </>
            )}
          </motion.g>
        );
      })}
    </g>
  );
}

/**
 * Source chip plus destination chips: A → B, C, D.
 *
 * @param source - Active concern on the ring
 * @param destinations - Other ends to name (already capped)
 * @param reduced - Whether the visitor asked for reduced motion
 */
function SourceDestLabels({
  source,
  destinations,
  reduced,
}: {
  readonly source: number;
  readonly destinations: ReadonlyArray<number>;
  readonly reduced: boolean;
}) {
  const src = CONCERNS[source]!;
  const seats = layoutChips([
    {
      key: `src-${src.text}`,
      label: src.text,
      angle: src.angle,
      emphasis: "source",
      tone: toneForElementName(src.element),
    },
    ...destinations.map((index) => {
      const dest = CONCERNS[index]!;
      return {
        key: `dest-${dest.text}`,
        label: dest.text,
        angle: dest.angle,
        emphasis: "destination" as const,
        tone: toneForElementName(dest.element),
      };
    }),
  ]);
  return (
    <>
      {seats.map((seat) => (
        <LabelChip key={seat.key} seat={seat} reduced={reduced} />
      ))}
    </>
  );
}

/**
 * Leaf labels on the hub side. A hover names one concern; the change feed names
 * the whole small operation. The element already carries its two-letter symbol,
 * so these chips sit on the outer band rather than beside the element nodes.
 */
function HubConcernLabels({
  sources,
  reduced,
}: {
  readonly sources: ReadonlyArray<number>;
  readonly reduced: boolean;
}) {
  if (sources.length === 0) return null;
  const seats = layoutChips(
    sources.map((index, rank) => {
      const concern = CONCERNS[index]!;
      return {
        key: `hub-${concern.text}`,
        label: concern.text,
        angle: concern.angle,
        emphasis: rank === 0 ? ("source" as const) : ("destination" as const),
        tone: toneForElementName(concern.element),
      };
    }),
  );
  return (
    <>
      {seats.map((seat) => (
        <LabelChip key={seat.key} seat={seat} reduced={reduced} />
      ))}
    </>
  );
}

/** Element chip plus its leaf destinations, collision-resolved. */
function HubElementLabels({
  element,
  visible,
  reduced,
}: {
  readonly element: (typeof ELEMENT_NODES)[number];
  readonly visible: number;
  readonly reduced: boolean;
}) {
  const seats = layoutChips([
    {
      key: `el-${element.name}`,
      label: element.name,
      angle: element.angle,
      emphasis: "source",
      tone: toneForElementName(element.name),
      nodeR: ELEMENT_RING,
      preferR: ELEMENT_RING + 34,
    },
    ...element.concerns
      .filter((index) => index < visible)
      .map((index) => {
        const dest = CONCERNS[index]!;
        return {
          key: `hub-dest-${dest.text}`,
          label: dest.text,
          angle: dest.angle,
          emphasis: "destination" as const,
          tone: toneForElementName(dest.element),
        };
      }),
  ]);
  return (
    <>
      {seats.map((seat) => (
        <LabelChip key={seat.key} seat={seat} reduced={reduced} />
      ))}
    </>
  );
}

/**
 * Travelling dash on a path normalised with SVG `pathLength={1}`.
 * Driven by the `.oke-seam-trace` CSS keyframes in `app/global.css` — Framer's
 * `pathOffset` left a frozen fleck on these edges.
 */
function SeamTrace({
  d,
  delayMs,
  durationMs,
  strokeWidth,
  opacity,
  stroke = "var(--color-fd-foreground)",
}: {
  readonly d: string;
  readonly delayMs: number;
  readonly durationMs: number;
  readonly strokeWidth: number;
  readonly opacity: number;
  /** Soft element ink when the dash belongs to a lit element. */
  readonly stroke?: string;
}) {
  return (
    <path
      d={d}
      pathLength={1}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      opacity={opacity}
      strokeDasharray="0.07 0.93"
      className="oke-seam-trace"
      style={{
        animationDuration: `${durationMs}ms`,
        animationDelay: `${delayMs}ms`,
      }}
    />
  );
}

/** Resting opacity of the mesh, and what a hover dims it to. */
const MESH_OPACITY = 0.18;
const MESH_DIMMED = 0.04;

/**
 * The mesh: every seam's geometry, and nothing that a pointer can change.
 *
 * Memoised on the step, because that is the only thing it depends on. Lighting
 * a seam mounts a bright line on the overlay above instead of restyling one
 * here, so moving the pointer around the ring costs one style write on the
 * wrapper rather than 136 React elements and 136 inline styles — which at four
 * times slower than this machine was the difference between a smooth hover and
 * a visible stutter.
 *
 * Each line lies along its own x axis and is scaled from nothing to full
 * length, which is how a seam grows out of the node that just arrived: CSS can
 * transition a transform, and cannot transition a line's endpoints.
 *
 * @param visible - Concerns present at the current step
 * @param reduced - Whether the visitor asked for reduced motion
 */
const SeamMesh = memo(function SeamMesh({
  visible,
  reduced,
}: {
  readonly visible: number;
  readonly reduced: boolean;
}) {
  return (
    <g
      stroke="var(--color-fd-muted-foreground)"
      strokeDasharray="2 3"
      strokeWidth="0.55"
      fill="none"
    >
      {SEAM_EDGES.map((edge) => {
        const shown = edge.b < visible;
        // `b` is in the arc that has just arrived, and the fan delay orders the
        // new seams along it, so a step reads as a spray rather than a flash.
        const fan =
          reduced || !shown ? 0 : (edge.b - ZOO_CONCERN_GROUPS[GROUP_OF[edge.b]!]!.start) * FAN_MS;
        return (
          <line
            key={edge.key}
            x1="0"
            y1="0"
            x2={edge.length}
            y2="0"
            style={{
              transformBox: "view-box",
              transformOrigin: "0 0",
              transform: `translate(${edge.ox}px, ${edge.oy}px) rotate(${edge.angle}deg) scaleX(${shown ? 1 : 0})`,
              transition: reduced ? undefined : `transform ${DRAW_MS}ms ${DRAW_EASE} ${fan}ms`,
            }}
          />
        );
      })}
    </g>
  );
});

/** A seam the diagram is currently lighting, and how it should look. */
type LitSeam = {
  readonly edge: (typeof SEAM_EDGES)[number];
  /** A hover lights hard; the change feed only warms. */
  readonly strong: boolean;
  readonly delayMs: number;
};

/**
 * The seams to light: those of the node under the pointer, or failing that
 * those of the concerns the change feed just changed.
 *
 * @param active - Hovered concern, if any
 * @param changed - Concerns the current beat changed, if the feed is running
 * @param visible - Concerns present at the current step
 * @param reduced - Whether the visitor asked for reduced motion
 */
function litSeamsFor(
  active: number | null,
  changed: ReadonlyArray<number>,
  visible: number,
  reduced: boolean,
): ReadonlyArray<LitSeam> {
  const live = active !== null ? [active] : changed;
  if (live.length === 0) return [];
  const strong = active !== null;
  const set = new Set(live);
  return SEAM_EDGES.filter((edge) => edge.b < visible && (set.has(edge.a) || set.has(edge.b))).map(
    (edge) => ({
      edge,
      strong,
      delayMs: reduced || strong ? 0 : hopsBetween(edge.a, edge.b) * WAVE_MS,
    }),
  );
}

type PanelProps = {
  readonly visible: number;
  readonly hover: Hover | null;
  readonly onHover: (next: Hover | null) => void;
  readonly reduced: boolean;
  /** Current change-feed beat, or null while the feed is paused. */
  readonly beat: Beat | null;
};

/** The curated seams between the concerns present so far. */
function ZooPanel({ visible, hover, onHover, reduced, beat }: PanelProps) {
  const active = hover?.kind === "concern" ? hover.index : null;
  const changed = beat?.concerns ?? [];
  const liveSet = new Set(changed);
  /** Concern named on screen: what the pointer is on, else the lead change. */
  const named = active ?? changed[0] ?? null;
  const litTone =
    named === null ? "var(--color-fd-foreground)" : toneForElementName(CONCERNS[named]!.element);
  const litSeams = litSeamsFor(active, active === null ? changed : [], visible, reduced);
  const lanes = beat === null || active !== null ? null : dashedSeams(beat, visible);
  /** Hover fans destinations; a multi-op beat names its own leaves instead. */
  const destinations = active !== null ? destinationIndices(active, visible) : [];
  const destSet = new Set(destinations);
  const activeElement = named === null ? null : CONCERNS[named]!.element;
  const quietElements =
    active !== null
      ? [activeElement!, ...destinations.map((index) => CONCERNS[index]!.element)]
      : changed.length > 0
        ? changed.map((index) => CONCERNS[index]!.element)
        : undefined;
  const node = reduced ? INSTANT : NODE;
  const fade = reduced ? INSTANT : FADE;
  const tint = reduced ? undefined : TINT;

  return (
    <motion.svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={PANEL_SVG}
      role="img"
      aria-label={`All ${TOTAL} infrastructure concerns the eight elements replace — ${ZOO_CONCERNS.map((c) => c.label).join(", ")} — wired to each other wherever they genuinely meet: credentials, invalidation, ordering, delivery. Not every pair, but ${zooSeamCount(TOTAL)} seams once all ${TOTAL} are present, and ${zooBusiest(TOTAL).label} alone owns ${zooBusiest(TOTAL).seams} of them.`}
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={fade}
    >
      {/*
       * One expression, not interpolated text: React gives a multi-child
       * `<title>` comment separators the server does not emit, and hydration
       * fails on the first paint.
       */}
      <title>{`The infrastructure zoo: ${TOTAL} concerns and the ${zooSeamCount(TOTAL)} seams between them`}</title>

      <GroupBands
        visible={visible}
        activeElement={activeElement}
        litElements={
          active !== null
            ? [activeElement!]
            : changed.length > 0
              ? changed.map((index) => CONCERNS[index]!.element)
              : undefined
        }
        quietElements={quietElements}
        reduced={reduced}
      />

      {/* The mesh, dimmed as a whole when the pointer singles a node out. */}
      <g
        aria-hidden="true"
        style={{
          opacity: active === null ? MESH_OPACITY : MESH_DIMMED,
          transition: reduced ? undefined : "opacity 280ms ease-out",
        }}
      >
        <SeamMesh visible={visible} reduced={reduced} />
      </g>

      {/* The light, and only the light: at most fifteen lines of it. */}
      <g aria-hidden="true">
        {litSeams.map(({ edge, strong, delayMs }) => (
          <line
            key={edge.key}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke={litTone}
            strokeWidth={strong ? 1.2 : 0.9}
            opacity={strong ? 0.85 : 0.42}
            className={reduced ? undefined : "oke-seam-lit"}
            style={reduced ? undefined : { animationDelay: `${delayMs}ms` }}
          />
        ))}
        {reduced || beat === null || lanes === null
          ? null
          : [...lanes].map(([key, lane]) => {
              const edge = SEAM_EDGES.find((candidate) => candidate.key === key);
              if (!edge) return null;
              return (
                <SeamTrace
                  key={`seam-${beat.index}-${key}`}
                  d={`M ${edge.x1} ${edge.y1} L ${edge.x2} ${edge.y2}`}
                  delayMs={(lane * TRACE_MS) / BEAT_LANES}
                  durationMs={TRACE_MS}
                  strokeWidth={1.4}
                  opacity={0.65}
                  stroke={litTone}
                />
              );
            })}
      </g>

      {CONCERNS.map((concern, i) => {
        const shown = i < visible;
        const isActive = active === i;
        const isLive = active === null && liveSet.has(i);
        const isDest = destSet.has(i);
        const dimmed = active !== null ? !isActive && !isDest : changed.length > 0 && !isLive;
        const tone = toneForElementName(concern.element);
        const lit = isActive || isLive || isDest;
        const halo = isActive ? 12 : isLive || isDest ? 10 : 0;
        const ring = shown ? (isActive ? 6.4 : isLive || isDest ? 5.6 : 4.8) : 0;
        const dot = shown ? (isActive ? 2.6 : isLive || isDest ? 2.2 : 1.9) : 0;
        return (
          <motion.g
            key={concern.text}
            tabIndex={shown ? 0 : -1}
            aria-label={
              shown
                ? `${concern.text} — ${zooDegree(i, visible)} seams: ${wiredTo(i, visible).join(", ")}`
                : `${concern.text} — not yet added`
            }
            onMouseEnter={() => onHover({ kind: "concern", index: i })}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover({ kind: "concern", index: i })}
            onBlur={() => onHover(null)}
            initial={false}
            animate={{ opacity: shown ? (dimmed ? 0.45 : 1) : 0 }}
            transition={fade}
            pointerEvents={shown ? "auto" : "none"}
            style={{ cursor: shown ? "pointer" : "default", outline: "none" }}
          >
            <motion.circle
              cx={concern.node.x}
              cy={concern.node.y}
              fill={lit ? tone : "var(--color-fd-foreground)"}
              style={tint}
              initial={false}
              animate={{ r: halo, opacity: isActive ? 0.14 : 0.09 }}
              transition={radius(halo, node, fade)}
            />
            <motion.circle
              cx={concern.node.x}
              cy={concern.node.y}
              fill="var(--color-fd-card)"
              stroke={lit ? tone : "var(--color-fd-muted-foreground)"}
              style={tint}
              initial={false}
              animate={{ r: ring, strokeWidth: isActive ? 1.4 : isLive || isDest ? 1.15 : 1 }}
              transition={radius(ring, node, fade)}
            />
            <motion.circle
              cx={concern.node.x}
              cy={concern.node.y}
              fill={lit ? tone : "var(--color-fd-foreground)"}
              style={tint}
              initial={false}
              animate={{ r: dot }}
              transition={radius(dot, node, fade)}
            />
            {/* Hit area sized for a pointer, independent of the drawn node. */}
            <circle cx={concern.node.x} cy={concern.node.y} r="9" fill="none" pointerEvents="all" />
          </motion.g>
        );
      })}

      {active !== null ? (
        <SourceDestLabels source={active} destinations={destinations} reduced={reduced} />
      ) : changed.length > 0 ? (
        <HubConcernLabels sources={changed} reduced={reduced} />
      ) : null}
    </motion.svg>
  );
}

/** The same concerns collapsed onto elements, each bound once to the law. */
function HubPanel({ visible, hover, onHover, reduced, beat }: PanelProps) {
  const activeElement =
    hover === null ? null : hover.kind === "element" ? hover.name : CONCERNS[hover.index]!.element;

  /** Concerns lit by the current hover: one, or every concern of an element. */
  const isActiveConcern = (index: number): boolean => {
    if (hover === null) return false;
    if (hover.kind === "concern") return hover.index === index;
    return CONCERNS[index]!.element === hover.name;
  };

  const changed = beat?.concerns ?? [];
  const liveSet = new Set(changed);
  const changedElements = [
    ...new Map(
      changed
        .map((index) => elementOf(index))
        .filter((element): element is NonNullable<typeof element> => element !== undefined)
        .map((element) => [element.name, element]),
    ).values(),
  ];

  /**
   * Labels: hovering an element names it as the source and its leaves as
   * destinations; a concern hover or a multi-op beat names the leaves.
   */
  const hoveredElement =
    hover?.kind === "element" ? ELEMENT_NODES.find((n) => n.name === hover.name) : undefined;
  const namedConcerns = hover?.kind === "concern" ? [hover.index] : hover === null ? changed : [];
  const quietElements =
    activeElement !== null
      ? [activeElement]
      : changedElements.length > 0
        ? changedElements.map((element) => element.name)
        : undefined;
  const litElements =
    activeElement !== null
      ? [activeElement]
      : changedElements.length > 0
        ? changedElements.map((element) => element.name)
        : undefined;

  const node = reduced ? INSTANT : NODE;
  const draw = reduced ? INSTANT : DRAW;
  const fade = reduced ? INSTANT : FADE;
  const tint = reduced ? undefined : TINT;

  return (
    <motion.svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={PANEL_SVG}
      role="img"
      aria-label={`The same ${TOTAL} concerns — ${ZOO_CONCERNS.map((c) => c.label).join(", ")} — collapsed onto eight elements — ${ELEMENTS.map((e) => e.name).join(", ")} — each concern attached to its element and each element bound once to the law, on(Trigger) gives Effects. ${treeEdgeCount(TOTAL)} edges instead of ${zooSeamCount(TOTAL)} seams, and one change is always ${TREE_CHANGE_COST} of them.`}
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={fade}
    >
      <title>{`okengine: ${TOTAL} concerns collapse onto eight elements bound to one law — ${treeEdgeCount(TOTAL)} edges`}</title>

      <defs>
        <radialGradient id="oke-law-glow">
          <stop offset="0%" stopColor="var(--color-fd-foreground)" stopOpacity="0.09" />
          <stop offset="100%" stopColor="var(--color-fd-foreground)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <GroupBands
        visible={visible}
        activeElement={activeElement}
        litElements={litElements}
        quietElements={quietElements}
        reduced={reduced}
      />

      <g aria-hidden="true">
        {/* The closed set of eight sits on one orbit. */}
        <circle
          cx={C}
          cy={C}
          r={ELEMENT_RING}
          fill="none"
          stroke="var(--color-fd-muted-foreground)"
          strokeWidth="0.6"
          strokeDasharray="1.5 5"
          opacity="0.22"
        />
        <circle cx={C} cy={C} r="66" fill="url(#oke-law-glow)" />

        {CONCERNS.map((concern, i) => {
          const element = elementOf(i);
          if (!element) return null;
          const shown = i < visible;
          const touched = isActiveConcern(i);
          const dimmed = hover !== null && !touched;
          const lit = touched || (liveSet.has(i) && hover === null);
          const tone = toneForElementName(concern.element);
          return (
            <motion.line
              key={`spoke-${concern.text}`}
              x1={concern.node.x}
              y1={concern.node.y}
              initial={false}
              animate={{
                // A spoke grows from its concern towards the element it joins.
                x2: shown ? element.node.x : concern.node.x,
                y2: shown ? element.node.y : concern.node.y,
                opacity: shown ? (touched ? 0.95 : lit ? 0.8 : dimmed ? 0.14 : 0.5) : 0,
                strokeWidth: touched ? 1.5 : lit ? 1.3 : 1,
              }}
              transition={{ x2: draw, y2: draw, opacity: fade, strokeWidth: fade }}
              stroke={lit ? tone : "var(--color-fd-muted-foreground)"}
              style={tint}
            />
          );
        })}

        {ELEMENT_NODES.map((element) => {
          const shown = element.firstConcern < visible;
          const touched = activeElement === element.name;
          const dimmed =
            activeElement !== null
              ? !touched
              : changedElements.length > 0 &&
                !changedElements.some((entry) => entry.name === element.name);
          const lit =
            touched ||
            (hover === null && changedElements.some((entry) => entry.name === element.name));
          const trunkDelay = reduced || !shown ? 0 : SPOKE_LEAD_S;
          const tone = toneForElementName(element.name);
          return (
            <motion.line
              key={`trunk-${element.name}`}
              x1={element.node.x}
              y1={element.node.y}
              initial={false}
              animate={{
                // A trunk grows from its element down to the law.
                x2: shown ? element.dock.x : element.node.x,
                y2: shown ? element.dock.y : element.node.y,
                opacity: shown ? (touched ? 1 : lit ? 0.9 : dimmed ? 0.2 : 0.65) : 0,
                strokeWidth: touched ? 1.8 : lit ? 1.5 : 1.2,
              }}
              /* The trunk waits for its element's first spoke to arrive. */
              transition={{
                x2: { ...draw, delay: trunkDelay },
                y2: { ...draw, delay: trunkDelay },
                opacity: fade,
                strokeWidth: fade,
              }}
              stroke={lit ? tone : "var(--color-fd-muted-foreground)"}
              style={tint}
            />
          );
        })}

        {/* One trace per lit concern in the beat: concern → element → law. */}
        {!reduced && beat !== null && hover === null
          ? changed.map((index, lane) => {
              const element = elementOf(index);
              const concern = CONCERNS[index];
              if (!element || !concern) return null;
              return (
                <SeamTrace
                  key={`trace-${beat.index}-${concern.text}`}
                  d={`M ${concern.node.x} ${concern.node.y} L ${element.node.x} ${element.node.y} L ${element.dock.x} ${element.dock.y}`}
                  delayMs={(lane * TRACE_MS) / Math.max(1, changed.length)}
                  durationMs={TRACE_MS}
                  strokeWidth={1.8}
                  opacity={0.8}
                  stroke={toneForElementName(element.name)}
                />
              );
            })
          : null}
      </g>

      {/* Element discs sit above spokes so junctions stay masked. */}
      {ELEMENT_NODES.map((element) => {
        const shown = element.firstConcern < visible;
        const touched = activeElement === element.name;
        const lit = hover === null && changedElements.some((entry) => entry.name === element.name);
        const inked = touched || lit;
        const tone = toneForElementName(element.name);
        const owned = element.concerns.filter((index) => index < visible);
        const halo = touched ? ELEMENT_R + 8 : lit ? ELEMENT_R + 6 : 0;
        const ring = shown ? ELEMENT_R : 0;
        const elementDimmed =
          activeElement !== null ? !touched : changedElements.length > 0 && !lit;
        return (
          <g
            key={element.name}
            tabIndex={shown ? 0 : -1}
            aria-label={`${element.name} — ${shown ? `subsumes ${owned.map((index) => CONCERNS[index]!.text).join(", ")}` : "not yet added"}`}
            onMouseEnter={() => onHover({ kind: "element", name: element.name })}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover({ kind: "element", name: element.name })}
            onBlur={() => onHover(null)}
            pointerEvents={shown ? "auto" : "none"}
            style={{ cursor: shown ? "pointer" : "default", outline: "none" }}
          >
            {/*
             * Opaque plate first — never inherits dim opacity, so spokes cannot
             * show through the symbol. Ink/stroke/text dim separately below.
             */}
            <motion.circle
              cx={element.node.x}
              cy={element.node.y}
              fill="var(--color-fd-background)"
              initial={false}
              animate={{ r: ring, opacity: shown ? 1 : 0 }}
              transition={radius(ring, node, fade)}
              style={{ pointerEvents: "none" }}
            />
            <motion.circle
              cx={element.node.x}
              cy={element.node.y}
              fill={inked ? tone : "var(--color-fd-foreground)"}
              style={{ ...tint, pointerEvents: "none" }}
              initial={false}
              animate={{ r: halo, opacity: shown ? (touched ? 0.14 : lit ? 0.09 : 0) : 0 }}
              transition={radius(halo, node, fade)}
            />
            <motion.circle
              cx={element.node.x}
              cy={element.node.y}
              fill={
                inked
                  ? `color-mix(in oklch, ${tone} 22%, var(--color-fd-background))`
                  : "var(--color-fd-background)"
              }
              stroke={inked ? tone : "var(--color-fd-muted-foreground)"}
              style={{ ...tint, pointerEvents: "none" }}
              initial={false}
              animate={{
                r: ring,
                strokeWidth: touched ? 1.4 : 1.15,
                strokeOpacity: shown ? (inked ? 1 : elementDimmed ? 0.45 : 0.75) : 0,
                opacity: shown ? 1 : 0,
              }}
              transition={radius(ring, node, fade)}
            />
            <motion.text
              x={element.node.x}
              y={element.node.y + 4}
              textAnchor="middle"
              fontSize="11.5"
              fontFamily="var(--font-mono, ui-monospace, monospace)"
              fill={inked ? tone : "var(--color-fd-foreground)"}
              style={{ ...tint, pointerEvents: "none" }}
              initial={false}
              animate={{ opacity: shown ? (elementDimmed ? 0.45 : 1) : 0 }}
              transition={fade}
            >
              {element.symbol}
            </motion.text>
            <circle
              cx={element.node.x}
              cy={element.node.y}
              r={ELEMENT_R + 4}
              fill="none"
              pointerEvents="all"
            />
          </g>
        );
      })}

      {/* Everything docks here. */}
      <g aria-hidden="true">
        <motion.circle
          // Remounted per beat so the arriving change lands as one pulse.
          key={beat === null ? "hub" : `hub-${beat.index}`}
          cx={C}
          cy={C}
          fill="var(--color-fd-background)"
          stroke="var(--color-fd-foreground)"
          strokeWidth="1"
          initial={false}
          animate={
            beat === null || reduced
              ? { r: HUB_R, strokeOpacity: 0.45 }
              : { r: [HUB_R, HUB_R + 2.5, HUB_R], strokeOpacity: [0.45, 0.85, 0.45] }
          }
          transition={
            beat === null || reduced
              ? INSTANT
              : { duration: 0.85, delay: BEAT_MS / 2 / 1000, ease: "easeOut" }
          }
        />
        <OkeLogo
          x={C - HUB_LOGO_W / 2}
          y={C - HUB_LOGO_H / 2}
          width={HUB_LOGO_W}
          height={HUB_LOGO_H}
          className="text-[var(--color-fd-foreground)]"
          aria-hidden
        />
      </g>

      {CONCERNS.map((concern, i) => {
        const shown = i < visible;
        const isActive = isActiveConcern(i);
        const isLive = hover === null && liveSet.has(i);
        const dimmed = hover !== null ? !isActive : changed.length > 0 && !isLive;
        const lit = isActive || isLive;
        const tone = toneForElementName(concern.element);
        const halo = isActive ? 9.5 : isLive ? 8 : 0;
        const dot = shown ? (isActive ? 4.6 : isLive ? 4.2 : 3.6) : 0;
        return (
          <motion.g
            key={concern.text}
            tabIndex={shown ? 0 : -1}
            aria-label={`${concern.text} — subsumed by ${concern.element}`}
            onMouseEnter={() => onHover({ kind: "concern", index: i })}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover({ kind: "concern", index: i })}
            onBlur={() => onHover(null)}
            initial={false}
            animate={{ opacity: shown ? (dimmed ? 0.45 : 1) : 0 }}
            transition={fade}
            pointerEvents={shown ? "auto" : "none"}
            style={{ cursor: shown ? "pointer" : "default", outline: "none" }}
          >
            <motion.circle
              cx={concern.node.x}
              cy={concern.node.y}
              fill={lit ? tone : "var(--color-fd-foreground)"}
              style={tint}
              initial={false}
              animate={{ r: halo, opacity: isActive ? 0.14 : 0.09 }}
              transition={radius(halo, node, fade)}
            />
            <motion.circle
              cx={concern.node.x}
              cy={concern.node.y}
              fill={lit ? tone : "var(--color-fd-muted-foreground)"}
              style={tint}
              initial={false}
              animate={{ r: dot }}
              transition={radius(dot, node, fade)}
            />
            <circle cx={concern.node.x} cy={concern.node.y} r="9" fill="none" pointerEvents="all" />
          </motion.g>
        );
      })}

      {hoveredElement ? (
        <HubElementLabels element={hoveredElement} visible={visible} reduced={reduced} />
      ) : (
        <HubConcernLabels sources={namedConcerns} reduced={reduced} />
      )}
    </motion.svg>
  );
}

/**
 * Stepped side-by-side contrast between the infrastructure zoo and the eight
 * elements: one counter grows with the curated seams, the other with spokes
 * and trunks.
 */
export function CollapseDiagram() {
  /** Open on the finished graph; Play / step controls still walk the pass. */
  const [step, setStep] = useState(LAST_STEP);
  const [playing, setPlaying] = useState(false);
  const [steered, setSteered] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [tick, setTick] = useState(0);

  /*
   * The preference decides what is rendered, not just how fast it gets there.
   * Server snapshot is false so hydration matches; after mount the real
   * preference opens on the finished graph (and skips the change feed).
   */
  const reduced = useClientReducedMotion();

  /** Reduced motion opens on the finished graph; the controls still steer it. */
  const shownStep = reduced && !steered ? LAST_STEP : step;
  const atEnd = shownStep >= LAST_STEP;
  const running = playing && !atEnd;

  /** The change feed yields to the step animation and to a real hover. */
  const feeding = !reduced && !running && hover === null;

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setStep((current) => current + 1), stepDelay(step));
    return () => window.clearTimeout(timer);
  }, [running, step]);

  useEffect(() => {
    if (!feeding) return;
    const timer = window.setInterval(() => setTick((current) => current + 1), BEAT_MS);
    return () => window.clearInterval(timer);
  }, [feeding]);

  const onHover = useCallback((next: Hover | null) => setHover(next), []);

  const goTo = useCallback((next: number) => {
    setSteered(true);
    setPlaying(false);
    setStep(next);
  }, []);

  const visible = visibleCount(shownStep);
  const zooEdges = zooSeamCount(visible);
  const hubEdges = treeEdgeCount(visible);
  const beat: Beat | null = feeding
    ? { index: tick, concerns: changedConcerns(tick, visible) }
    : null;
  const readout = readoutFor(visible, shownStep, hover, beat);

  return (
    /*
     * Gate motion in the tree via `reduced` (instant transitions, no scale /
     * change-feed). Keep MotionConfig at `never` so Motion does not refuse
     * transform animates and warn under the OS preference.
     */
    <MotionConfig reducedMotion="never" transition={reduced ? INSTANT : FADE}>
      <div
        className="@container w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
        aria-label={`The collapse: ${TOTAL} infrastructure concerns as ${zooSeamCount(TOTAL)} hand-maintained seams on the left, or ${treeEdgeCount(TOTAL)} edges on eight elements bound once to the law on the right.`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-fd-primary ring-2 ring-fd-border"
            />
            <span className="font-mono text-[11px] tracking-[0.14em] text-fd-muted-foreground uppercase">
              the collapse
            </span>
          </div>
          <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground tabular-nums">
            <EdgeCount value={zooEdges} reduced={reduced} /> seams →{" "}
            <EdgeCount value={hubEdges} reduced={reduced} /> edges
          </code>
        </div>

        <div
          className="grid gap-px bg-fd-border @min-[42rem]:grid-cols-2"
          onMouseLeave={() => setHover(null)}
        >
          <ShapeColumn
            label="the zoo"
            metricLabel="seams"
            metric={<EdgeCount value={zooEdges} reduced={reduced} />}
            concerns={visible}
            caption={captionFor("zoo", shownStep)}
          >
            <ZooPanel
              visible={visible}
              hover={hover}
              onHover={onHover}
              reduced={reduced}
              beat={beat}
            />
          </ShapeColumn>

          <ShapeColumn
            label="okengine"
            metricLabel="edges"
            metric={<EdgeCount value={hubEdges} reduced={reduced} />}
            concerns={visible}
            caption={captionFor("okengine", shownStep)}
          >
            <HubPanel
              visible={visible}
              hover={hover}
              onHover={onHover}
              reduced={reduced}
              beat={beat}
            />
          </ShapeColumn>
        </div>

        {/*
         * Same 2-col + gap-px seam as the rings above, so the live strip and
         * prose sit under the zoo / okengine columns instead of drifting past
         * the center line with a different fraction grid.
         */}
        <div className="grid gap-px border-t border-fd-border bg-fd-border @min-[42rem]:grid-cols-2">
          <div className="flex flex-col gap-2 bg-fd-card px-3 py-4 sm:px-5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground/70 uppercase">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    readout.mode === "live"
                      ? "animate-pulse bg-fd-primary"
                      : "bg-fd-muted-foreground/40",
                  )}
                />
                {readout.mode}
              </span>
              {readout.progress ? (
                <span className="font-mono text-[10px] text-fd-muted-foreground/70 tabular-nums">
                  {readout.progress}
                </span>
              ) : null}
            </div>

            <dl className="flex flex-col gap-1">
              {readout.rows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-3 font-mono text-[11px]"
                >
                  <dt className="text-fd-muted-foreground">{row.label}</dt>
                  <dd className="truncate text-fd-foreground tabular-nums">{row.value}</dd>
                </div>
              ))}
            </dl>

            <p className="min-h-8 text-xs leading-relaxed text-fd-muted-foreground">
              {readout.note}
            </p>
          </div>

          <div className="flex flex-col gap-2 border-t border-fd-border bg-fd-card px-3 py-4 sm:px-5 @min-[42rem]:border-t-0">
            {PROSE.map((line) => (
              <p key={line} className="text-xs leading-relaxed text-fd-muted-foreground">
                {line}
              </p>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-fd-border px-4 py-2">
          <div className="flex items-center gap-1">
            <ControlButton
              label="Restart"
              onClick={() => goTo(0)}
              disabled={shownStep === 0 && !running}
            >
              <RotateCcw className="size-3.5" aria-hidden />
            </ControlButton>
            <ControlButton
              label="Previous step"
              onClick={() => goTo(Math.max(0, shownStep - 1))}
              disabled={shownStep === 0}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </ControlButton>
            <ControlButton
              label={running ? "Pause" : atEnd ? "Replay" : "Play"}
              onClick={() => {
                if (running) {
                  setPlaying(false);
                  return;
                }
                setSteered(true);
                if (atEnd) setStep(0);
                setPlaying(true);
              }}
            >
              {running ? (
                <Pause className="size-3.5" aria-hidden />
              ) : (
                <Play className="size-3.5" aria-hidden />
              )}
            </ControlButton>
            <ControlButton
              label="Next step"
              onClick={() => goTo(Math.min(LAST_STEP, shownStep + 1))}
              disabled={atEnd}
            >
              <ChevronRight className="size-4" aria-hidden />
            </ControlButton>
          </div>

          <span className="font-mono text-[11px] text-fd-muted-foreground">
            step {shownStep + 1} / {LAST_STEP + 1}
          </span>
        </div>
      </div>
    </MotionConfig>
  );
}

/**
 * One ring column: label, square SVG, concern/edge counts, and the step caption.
 *
 * @param label - Shape name shown above the ring
 * @param metricLabel - "seams" or "edges"
 * @param metric - Animated counter for that metric
 * @param concerns - Concerns present at the current step
 * @param caption - Live caption for this shape at the current step
 * @param children - ZooPanel or HubPanel
 */
function ShapeColumn({
  label,
  metricLabel,
  metric,
  concerns,
  caption,
  children,
}: {
  label: string;
  metricLabel: string;
  metric: ReactNode;
  concerns: number;
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 bg-fd-card px-3 py-4 sm:px-5 sm:py-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] tracking-[0.14em] text-fd-muted-foreground uppercase">
          {label}
        </span>
        <dl className="flex items-baseline gap-3 font-mono text-[11px] tabular-nums">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-fd-muted-foreground/70">concerns</dt>
            <dd className="text-fd-foreground">{concerns}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-fd-muted-foreground/70">{metricLabel}</dt>
            <dd className="text-base leading-none font-medium text-fd-foreground">{metric}</dd>
          </div>
        </dl>
      </div>

      <div className="mx-auto aspect-square w-full max-w-[28rem]">{children}</div>

      <p aria-live="polite" className="text-sm leading-snug text-fd-foreground">
        {caption}
      </p>
    </div>
  );
}

/**
 * The connection counter, rolled rather than swapped: the whole argument is
 * that one of these two numbers climbs far faster than the other, so the climb
 * is worth watching side by side.
 *
 * The rolled value never re-renders React; the motion value writes the text
 * node itself.
 *
 * @param value - Seams, or edges, at the current step
 * @param reduced - Whether the visitor asked for reduced motion
 */
function EdgeCount({ value, reduced }: { value: number; reduced: boolean }) {
  const count = useMotionValue(value);
  const rounded = useTransform(count, (latest) => Math.round(latest));

  useEffect(() => {
    if (reduced) {
      count.jump(value);
      return;
    }
    // Shorter than the roll wants to be, so it still lands between the quick
    // steps at the start of the pass rather than lagging a step behind.
    const controls = animate(count, value, { duration: 0.34, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [count, value, reduced]);

  return <motion.span className="tabular-nums">{rounded}</motion.span>;
}

/**
 * Icon button in the diagram control strip.
 *
 * @param label - Accessible name
 * @param onClick - Click handler
 * @param disabled - Whether the control is unavailable at this step
 * @param children - Icon
 */
function ControlButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex size-7 items-center justify-center rounded-md text-fd-muted-foreground transition-colors hover:bg-fd-secondary/60 hover:text-fd-foreground disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}
