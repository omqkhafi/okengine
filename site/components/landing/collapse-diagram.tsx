/**
 * Collapse diagram — the integration curve, stepped one element's worth of
 * concerns at a time.
 *
 * Both tabs add the same concerns in the same order: every concern the §5 table
 * says the eight elements replace, all forty of them. In "the zoo" a concern
 * lands on the several concerns already present that it genuinely has to know
 * about — the curated seams in `lib/zoo-graph.ts`, not a complete graph — so
 * the seams you own outgrow the concerns you added. In "okengine" a concern
 * attaches to its element and the element is bound once to the law, so one
 * spoke arrives and the trunk is already there. Stepping through both with the
 * same readout is the argument, and every number on screen is counted from the
 * seam data rather than from a formula.
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
 * text would then render at four real pixels. So the nodes are points, the ring
 * is broken into one arc per element, and exactly one label is drawn at a time,
 * as a clamped chip: whatever the pointer or the change feed is on. Nothing is
 * lost to a screen reader — every node's `aria-label` still enumerates its
 * seams by name, and the panel labels enumerate all forty concerns.
 *
 * Two live layers carry the argument without the user touching anything.
 * Hovering any node lights only its own seams — two to fifteen of them in the
 * zoo, always two here. While idle, a change feed jumps around the ring, one
 * concern per beat, and costs that one change in both shapes. The jump is a
 * deterministic hash of the beat index, never `Math.random`: the server renders
 * beat zero too, and a different pick in the browser is a hydration mismatch.
 *
 * Concept inspired by the stepped "problem space" diagrams on https://iii.dev
 * (see site/NOTICE); geometry, markup, interaction, and copy are written from
 * scratch here.
 *
 * Motion note: each kind of value gets the transition that suits it — springs
 * for anything that changes size, so an arriving node has weight; a long ease
 * for edges, which do not fade in but *grow out of* the node that just arrived,
 * staggered within the arriving arc so a step reads as a fan. The travelling
 * dash of a change is CSS (`stroke-dashoffset` on a path with SVG
 * `pathLength={1}`), not Framer — `pathOffset` left a frozen fleck on the lit
 * seams. Switching tabs crossfades the two shapes in place.
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
 * 50 ms p95 in dev and 34 ms in a production build, where the whole pass and
 * the tab crossfade hold 60 fps. Everything else — nodes, spokes, trunks,
 * traces, the crossfade, the counter — is still Framer, which is comfortable
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

'use client';

import {
  animate,
  AnimatePresence,
  motion,
  MotionConfig,
  useMotionValue,
  useTransform,
} from 'framer-motion';
import type { Transition } from 'framer-motion';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { ELEMENTS, ZOO_CONCERN_GROUPS, ZOO_CONCERNS } from '@/lib/elements';
import { toneForElementName } from '@/lib/element-tones';
import { useClientReducedMotion } from '@/lib/use-client-reduced-motion';
import {
  TREE_CHANGE_COST,
  treeEdgeCount,
  ZOO_SEAM_PAIRS,
  zooBusiest,
  zooDegree,
  zooPassCost,
  zooSeamCount,
  zooSeamsOf,
} from '@/lib/zoo-graph';

const VIEW = 420;
const C = VIEW / 2;
const CONCERN_RING = 152;
const ELEMENT_RING = 88;
const ELEMENT_R = 14;
const HUB_R = 36;

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

/** Change-feed period: one changed concern per beat. */
const BEAT_MS = 1100;

/** One lap of the travelling dash along a lit seam. */
const TRACE_MS = 650;

/** Seams of the changed concern that carry a travelling dash, not just a glow. */
const BEAT_LANES = 3;

/** Anything that changes size arrives with weight. */
const NODE: Transition = { type: 'spring', stiffness: 320, damping: 26, mass: 0.6 };

/** Edges grow rather than fade, so they need a long, decelerating ease. */
const DRAW_MS = 500;
const DRAW_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const DRAW: Transition = { duration: DRAW_MS / 1000, ease: [0.22, 1, 0.36, 1] };

/** Lighting, dimming, and crossfades. */
const FADE: Transition = { duration: 0.28, ease: 'easeOut' };

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
const TINT: CSSProperties = { transition: 'fill 240ms ease, stroke 240ms ease' };

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
    /** Where this concern's label chip wants to sit, before clamping. */
    labelPoint: pointAt(CONCERN_RING + 20, angle),
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
    /** Where this element's label chip wants to sit, before clamping. */
    labelPoint: pointAt(CONCERN_RING + 20, angle),
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
 * Which concern the feed changes on `tick`. A hash rather than `tick % visible`,
 * so the feed reads like change traffic instead of a lap of the ring, with a
 * repeated pick nudged along so every beat is visibly a new change.
 *
 * The nudge has to compare against the pick that was actually shown, not the
 * raw hash behind it, so the sequence is folded forward over a short fixed
 * window — bounded work, and the same answer on the server as in the browser.
 *
 * @param tick - Beat index since the feed started
 * @param visible - Concerns present at the current step
 */
function changedConcern(tick: number, visible: number): number {
  if (visible < 2) return 0;
  let shown = mix32(tick - FEED_WINDOW) % visible;
  for (let t = tick - FEED_WINDOW + 1; t <= tick; t += 1) {
    const pick = mix32(t) % visible;
    shown = pick === shown ? (pick + 1) % visible : pick;
  }
  return shown;
}

/** `a, b and c`, for a caption that names the concerns it is counting. */
function listOf(labels: ReadonlyArray<string>): string {
  if (labels.length < 2) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
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

type TabId = 'zoo' | 'okengine';

/** Which node the pointer or keyboard focus is on. */
type Hover =
  | { readonly kind: 'concern'; readonly index: number }
  | { readonly kind: 'element'; readonly name: string };

/** Plural `s` when `count` is not one. */
function s(count: number): string {
  return count === 1 ? '' : 's';
}

/** Live caption naming what the current step just added. */
function captionFor(tab: TabId, step: number): string {
  const group = groupAt(step);
  const visible = group.end;
  const arrived = listOf(groupLabels(step));

  if (tab === 'zoo') {
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
          ? 'the same as the tangle costs so far'
          : `already fewer than the ${zoo} the tangle costs so far`;
    return `${arrived} collapse onto ${group.element} — ${total} edges, ${against}.`;
  }
  return `+ ${arrived} → ${group.element} — ${spokes} spokes and 1 trunk, ${total} edges in total.`;
}

/**
 * What one change to `index` costs: every seam that concern owns in the zoo, or
 * its spoke plus the trunk its element already holds.
 *
 * @param tab - Which shape is showing
 * @param index - Ring position of the changed concern
 * @param visible - Concerns present at the current step
 */
function changeCost(tab: TabId, index: number, visible: number): number {
  return tab === 'zoo' ? zooDegree(index, visible) : TREE_CHANGE_COST;
}

/** One label/value line of the readout. */
type ReadoutRow = { readonly label: string; readonly value: string };

/** What the readout column reports: the beat, the hovered node, or the step. */
type Readout = {
  readonly mode: 'live' | 'hover' | 'step';
  readonly progress: string | null;
  readonly rows: ReadonlyArray<ReadoutRow>;
  readonly note: string;
};

/**
 * The readout, in priority order: a hover always wins, then the change feed,
 * then the step that is on screen.
 *
 * @param tab - Which shape is showing
 * @param visible - Concerns present at the current step
 * @param step - Current step index
 * @param hover - Hovered node, if any
 * @param beat - Current change-feed beat, if the feed is running
 */
function readoutFor(
  tab: TabId,
  visible: number,
  step: number,
  hover: Hover | null,
  beat: Beat | null,
): Readout {
  if (hover?.kind === 'element') {
    const element = ELEMENT_NODES.find((node) => node.name === hover.name);
    const owned = (element?.concerns ?? []).filter((index) => index < visible);
    const labels = owned.map((index) => CONCERNS[index]!.text);
    return {
      mode: 'hover',
      progress: null,
      rows: [
        { label: 'element', value: hover.name },
        { label: 'edges', value: `${owned.length + 1}` },
        { label: 'subsumes', value: labels.join(' · ') },
      ],
      note: `${hover.name} subsumes ${labels.join(' · ')} — ${owned.length} spoke${s(owned.length)} and one trunk to the law.`,
    };
  }

  if (hover?.kind === 'concern') {
    const concern = CONCERNS[hover.index]!;
    const cost = changeCost(tab, hover.index, visible);
    // The busiest node owns fifteen seams, and fifteen labels would reflow the
    // column under the pointer, so the note names a few and counts the rest.
    const named = wiredTo(hover.index, visible);
    const seams =
      named.length > 4 ? `${listOf(named.slice(0, 3))} and ${named.length - 3} more` : listOf(named);
    return {
      mode: 'hover',
      progress: null,
      rows: [
        { label: 'node', value: concern.text },
        { label: tab === 'zoo' ? 'seams' : 'edges', value: `${cost}` },
        {
          label: tab === 'zoo' ? 'wired to' : 'element',
          value:
            tab === 'zoo'
              ? named.length > 3
                ? `${named.slice(0, 3).join(' · ')} +${named.length - 3}`
                : named.join(' · ')
              : concern.element,
        },
      ],
      note:
        tab === 'zoo'
          ? `${concern.text} is wired to ${seams} — ${cost} seam${s(cost)} to keep in sync.`
          : `${concern.text} → ${concern.element} — 2 edges: one spoke, and a trunk ${concern.element} already owns.`,
    };
  }

  if (beat) {
    const concern = CONCERNS[beat.concern]!;
    const cost = changeCost(tab, beat.concern, visible);
    // The worst one change can cost in this shape — always two on the hub side,
    // which is the whole point of the comparison.
    const busiest = tab === 'zoo' ? zooBusiest(visible) : null;
    return {
      mode: 'live',
      progress: `change ${beat.index + 1}`,
      rows: [
        { label: 'changed', value: concern.text },
        { label: 'edges re-checked', value: `${cost}` },
        {
          label: 'busiest node',
          value: busiest ? `${busiest.label} · ${busiest.seams}` : `any · ${TREE_CHANGE_COST}`,
        },
      ],
      note:
        tab === 'zoo'
          ? `Change ${concern.text} and all ${cost} of its seams have to be re-checked.`
          : `Change ${concern.text} and it is one spoke — ${concern.element} is already bound to the law.`,
    };
  }

  const group = groupAt(step);
  const total = tab === 'zoo' ? zooSeamCount(visible) : treeEdgeCount(visible);
  return {
    mode: 'step',
    progress: `step ${step + 1} / ${LAST_STEP + 1}`,
    rows: [
      { label: 'added', value: `${group.element} · ${group.end - group.start}` },
      { label: tab === 'zoo' ? 'seams' : 'edges', value: `${total}` },
      {
        label: tab === 'zoo' ? 'if each changed once' : 'trunks',
        value: tab === 'zoo' ? `${zooPassCost(visible)}` : `${step + 1}`,
      },
    ],
    note: 'Hover any node, or let the feed cost one change at a time.',
  };
}

/** One beat of the change feed: concern `concern` just changed. */
type Beat = { readonly index: number; readonly concern: number };

/**
 * Seams of the changed concern that carry a travelling dash, keyed by edge with
 * the lane that phases it.
 *
 * Integer arithmetic only: a `Math.random` or `Math.sin` pick would choose
 * different edges on the server than in the browser, which React reports as a
 * hydration mismatch on the first paint.
 */
function dashedSeams(beat: Beat, visible: number): ReadonlyMap<string, number> {
  const seams = SEAM_EDGES.filter(
    (edge) => edge.b < visible && (edge.a === beat.concern || edge.b === beat.concern),
  );
  const lanes = new Map<string, number>();
  for (let lane = 0; lane < BEAT_LANES && lane < seams.length; lane += 1) {
    lanes.set(seams[(beat.index * 5 + lane * 7) % seams.length]!.key, lane);
  }
  return lanes;
}

const TABS: ReadonlyArray<{ readonly id: TabId; readonly label: string }> = [
  { id: 'zoo', label: 'the zoo' },
  { id: 'okengine', label: 'okengine' },
];

const PROSE: Readonly<Record<TabId, ReadonlyArray<string>>> = {
  zoo: [
    `All ${TOTAL} concerns the eight elements replace, straight off the unified theory's §5 table — each its own tool, client, and config.`,
    `An edge is drawn only where two concerns genuinely meet: a credential, an invalidation, an ordering, a delivery. That is still ${zooSeamCount(TOTAL)} seams you own, and a trace that stops at every one of them.`,
  ],
  okengine: [
    `The same ${TOTAL} concerns, collapsed. A concern belongs to an element; the element is bound once to the law.`,
    `Concern ${TOTAL + 1} adds one edge and no new element — the set of eight is closed — and effects stay inferred from what the flow touches through fx.`,
  ],
};

/** Both shapes share the square cell, so a tab switch can crossfade in place. */
const PANEL_SVG = 'absolute inset-0 size-full';

/** Advance of the mono face at the 11.5px label size, close enough to lay out a chip. */
const LABEL_CHAR = 6.9;
const CHIP_PAD_X = 7;
const CHIP_H = 18;
const CHIP_MARGIN = 3;

/** Keep `value` inside `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The one label on screen, drawn as a chip beside the node it names.
 *
 * Forty labels do not fit the ring, so only the node under the pointer, the
 * keyboard focus, or the change feed is named — and because the longest label
 * is wider than the margin outside the ring, the chip is clamped into the
 * viewBox rather than allowed to run off the edge. It sits over the mesh on an
 * opaque card fill, which is what keeps it legible where it has to overlap.
 *
 * @param label - Concern or element name
 * @param at - Where the chip would like to sit, before clamping
 * @param reduced - Whether the visitor asked for reduced motion
 * @param tone - Soft element ink for the chip stroke and text, when lit
 */
function LabelChip({
  label,
  at,
  reduced,
  tone,
}: {
  readonly label: string;
  readonly at: Point;
  readonly reduced: boolean;
  readonly tone?: string;
}) {
  const width = label.length * LABEL_CHAR + CHIP_PAD_X * 2;
  const x = clamp(at.x, width / 2 + CHIP_MARGIN, VIEW - width / 2 - CHIP_MARGIN);
  const y = clamp(at.y, CHIP_H / 2 + CHIP_MARGIN, VIEW - CHIP_H / 2 - CHIP_MARGIN);
  const ink = tone ?? 'var(--color-fd-foreground)';
  return (
    <motion.g
      key={label}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduced ? INSTANT : FADE}
      pointerEvents="none"
      aria-hidden="true"
    >
      <rect
        x={round(x - width / 2)}
        y={round(y - CHIP_H / 2)}
        width={round(width)}
        height={CHIP_H}
        rx="4"
        fill="var(--color-fd-card)"
        stroke={tone ?? 'var(--color-fd-border)'}
        strokeWidth="1"
        style={reduced ? undefined : TINT}
      />
      <text
        x={round(x)}
        y={round(y + 4)}
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
  stroke = 'var(--color-fd-foreground)',
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
              transformBox: 'view-box',
              transformOrigin: '0 0',
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
 * those of the concern the change feed just changed.
 *
 * @param active - Hovered concern, if any
 * @param changed - Concern the current beat changed, if the feed is running
 * @param visible - Concerns present at the current step
 * @param reduced - Whether the visitor asked for reduced motion
 */
function litSeamsFor(
  active: number | null,
  changed: number | null,
  visible: number,
  reduced: boolean,
): ReadonlyArray<LitSeam> {
  const index = active ?? changed;
  if (index === null) return [];
  const strong = active !== null;
  return SEAM_EDGES.filter(
    (edge) => edge.b < visible && (edge.a === index || edge.b === index),
  ).map((edge) => ({
    edge,
    strong,
    delayMs: reduced || strong ? 0 : hopsBetween(edge.a, edge.b) * WAVE_MS,
  }));
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
  const active = hover?.kind === 'concern' ? hover.index : null;
  const changed = beat?.concern ?? null;
  /** The one concern named on screen: what the pointer is on, else the change. */
  const named = active ?? changed;
  const litTone =
    named === null ? 'var(--color-fd-foreground)' : toneForElementName(CONCERNS[named]!.element);
  const litSeams = litSeamsFor(active, active === null ? changed : null, visible, reduced);
  const lanes = beat === null || active !== null ? null : dashedSeams(beat, visible);
  const node = reduced ? INSTANT : NODE;
  const fade = reduced ? INSTANT : FADE;
  const tint = reduced ? undefined : TINT;

  return (
    <motion.svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={PANEL_SVG}
      role="img"
      aria-label={`All ${TOTAL} infrastructure concerns the eight elements replace — ${ZOO_CONCERNS.map((c) => c.label).join(', ')} — wired to each other wherever they genuinely meet: credentials, invalidation, ordering, delivery. Not every pair, but ${zooSeamCount(TOTAL)} seams once all ${TOTAL} are present, and ${zooBusiest(TOTAL).label} alone owns ${zooBusiest(TOTAL).seams} of them.`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.03 }}
      transition={fade}
    >
      {/*
       * One expression, not interpolated text: React gives a multi-child
       * `<title>` comment separators the server does not emit, and hydration
       * fails on the first paint.
       */}
      <title>{`The infrastructure zoo: ${TOTAL} concerns and the ${zooSeamCount(TOTAL)} seams between them`}</title>

      {/* The mesh, dimmed as a whole when the pointer singles a node out. */}
      <g
        aria-hidden="true"
        style={{
          opacity: active === null ? MESH_OPACITY : MESH_DIMMED,
          transition: reduced ? undefined : 'opacity 280ms ease-out',
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
            className={reduced ? undefined : 'oke-seam-lit'}
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
        const isLive = active === null && changed === i;
        const dimmed = active !== null && !isActive;
        const tone = toneForElementName(concern.element);
        const lit = isActive || isLive;
        const halo = isActive ? 12 : isLive ? 10 : 0;
        const ring = shown ? (isActive ? 6.4 : 4.8) : 0;
        const dot = shown ? (isActive ? 2.6 : 1.9) : 0;
        return (
          <motion.g
            key={concern.text}
            tabIndex={shown ? 0 : -1}
            aria-label={
              shown
                ? `${concern.text} — ${zooDegree(i, visible)} seams: ${wiredTo(i, visible).join(', ')}`
                : `${concern.text} — not yet added`
            }
            onMouseEnter={() => onHover({ kind: 'concern', index: i })}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover({ kind: 'concern', index: i })}
            onBlur={() => onHover(null)}
            initial={false}
            animate={{ opacity: shown ? (dimmed ? 0.45 : 1) : 0 }}
            transition={fade}
            pointerEvents={shown ? 'auto' : 'none'}
            style={{ cursor: shown ? 'pointer' : 'default', outline: 'none' }}
          >
            <motion.circle
              cx={concern.node.x}
              cy={concern.node.y}
              fill={lit ? tone : 'var(--color-fd-foreground)'}
              style={tint}
              initial={false}
              animate={{ r: halo, opacity: isActive ? 0.14 : 0.09 }}
              transition={radius(halo, node, fade)}
            />
            <motion.circle
              cx={concern.node.x}
              cy={concern.node.y}
              fill="var(--color-fd-card)"
              stroke={lit ? tone : 'var(--color-fd-muted-foreground)'}
              style={tint}
              initial={false}
              animate={{ r: ring, strokeWidth: isActive ? 1.4 : 1 }}
              transition={radius(ring, node, fade)}
            />
            <motion.circle
              cx={concern.node.x}
              cy={concern.node.y}
              fill={lit ? tone : 'var(--color-fd-foreground)'}
              style={tint}
              initial={false}
              animate={{ r: dot }}
              transition={radius(dot, node, fade)}
            />
            {/* Hit area sized for a pointer, independent of the drawn node. */}
            <circle cx={concern.node.x} cy={concern.node.y} r="9" fill="transparent" />
          </motion.g>
        );
      })}

      {named === null ? null : (
        <LabelChip
          label={CONCERNS[named]!.text}
          at={CONCERNS[named]!.labelPoint}
          reduced={reduced}
          tone={toneForElementName(CONCERNS[named]!.element)}
        />
      )}
    </motion.svg>
  );
}

/** The same concerns collapsed onto elements, each bound once to the law. */
function HubPanel({ visible, hover, onHover, reduced, beat }: PanelProps) {
  const activeElement =
    hover === null
      ? null
      : hover.kind === 'element'
        ? hover.name
        : CONCERNS[hover.index]!.element;

  /** Concerns lit by the current hover: one, or every concern of an element. */
  const isActiveConcern = (index: number): boolean => {
    if (hover === null) return false;
    if (hover.kind === 'concern') return hover.index === index;
    return CONCERNS[index]!.element === hover.name;
  };

  const changed = beat?.concern ?? null;
  const changedElement = changed === null ? undefined : elementOf(changed);

  /**
   * The one label on screen. Hovering an element names the arc rather than any
   * one concern of it, which is the only label the eight symbols do not already
   * carry.
   */
  const hoveredElement =
    hover?.kind === 'element' ? ELEMENT_NODES.find((n) => n.name === hover.name) : undefined;
  const namedConcern = hover?.kind === 'concern' ? hover.index : hover === null ? changed : null;
  const named: { readonly label: string; readonly at: Point } | null = hoveredElement
    ? { label: hoveredElement.name, at: hoveredElement.labelPoint }
    : namedConcern === null
      ? null
      : { label: CONCERNS[namedConcern]!.text, at: CONCERNS[namedConcern]!.labelPoint };

  const node = reduced ? INSTANT : NODE;
  const draw = reduced ? INSTANT : DRAW;
  const fade = reduced ? INSTANT : FADE;
  const tint = reduced ? undefined : TINT;

  return (
    <motion.svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={PANEL_SVG}
      role="img"
      aria-label={`The same ${TOTAL} concerns — ${ZOO_CONCERNS.map((c) => c.label).join(', ')} — collapsed onto eight elements — ${ELEMENTS.map((e) => e.name).join(', ')} — each concern attached to its element and each element bound once to the law, on(Trigger) gives Effects. ${treeEdgeCount(TOTAL)} edges instead of ${zooSeamCount(TOTAL)} seams, and one change is always ${TREE_CHANGE_COST} of them.`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.03 }}
      transition={fade}
    >
      <title>{`okengine: ${TOTAL} concerns collapse onto eight elements bound to one law — ${treeEdgeCount(TOTAL)} edges`}</title>

      <defs>
        <radialGradient id="oke-law-glow">
          <stop offset="0%" stopColor="var(--color-fd-foreground)" stopOpacity="0.09" />
          <stop offset="100%" stopColor="var(--color-fd-foreground)" stopOpacity="0" />
        </radialGradient>
      </defs>

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
          const lit = touched || (changed === i && hover === null);
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
              stroke={lit ? tone : 'var(--color-fd-muted-foreground)'}
              style={tint}
            />
          );
        })}

        {ELEMENT_NODES.map((element) => {
          const shown = element.firstConcern < visible;
          const touched = activeElement === element.name;
          const dimmed = activeElement !== null && !touched;
          const lit = touched || (changedElement?.name === element.name && hover === null);
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
              stroke={lit ? tone : 'var(--color-fd-muted-foreground)'}
              style={tint}
            />
          );
        })}

        {/* One trace per beat, concern → element → law. */}
        {!reduced && beat !== null && changed !== null && changedElement && hover === null ? (
          <SeamTrace
            key={`trace-${beat.index}`}
            d={`M ${CONCERNS[changed]!.node.x} ${CONCERNS[changed]!.node.y} L ${changedElement.node.x} ${changedElement.node.y} L ${changedElement.dock.x} ${changedElement.dock.y}`}
            delayMs={0}
            durationMs={TRACE_MS}
            strokeWidth={1.8}
            opacity={0.8}
            stroke={toneForElementName(changedElement.name)}
          />
        ) : null}
      </g>

      {/* Element circles cover the inner ends of the concern spokes. */}
      {ELEMENT_NODES.map((element) => {
        const shown = element.firstConcern < visible;
        const touched = activeElement === element.name;
        const lit = changedElement?.name === element.name && hover === null;
        const inked = touched || lit;
        const tone = toneForElementName(element.name);
        const owned = element.concerns.filter((index) => index < visible);
        const halo = touched ? ELEMENT_R + 8 : lit ? ELEMENT_R + 6 : 0;
        const ring = shown ? ELEMENT_R : 0;
        return (
          <motion.g
            key={element.name}
            tabIndex={shown ? 0 : -1}
            aria-label={`${element.name} — ${shown ? `subsumes ${owned.map((index) => CONCERNS[index]!.text).join(', ')}` : 'not yet added'}`}
            onMouseEnter={() => onHover({ kind: 'element', name: element.name })}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover({ kind: 'element', name: element.name })}
            onBlur={() => onHover(null)}
            initial={false}
            animate={{ opacity: shown ? (activeElement !== null && !touched ? 0.4 : 1) : 0 }}
            transition={fade}
            pointerEvents={shown ? 'auto' : 'none'}
            style={{ cursor: shown ? 'pointer' : 'default', outline: 'none' }}
          >
            <motion.circle
              cx={element.node.x}
              cy={element.node.y}
              fill={inked ? tone : 'var(--color-fd-foreground)'}
              style={tint}
              initial={false}
              animate={{ r: halo, opacity: touched ? 0.14 : 0.09 }}
              transition={radius(halo, node, fade)}
            />
            <motion.circle
              cx={element.node.x}
              cy={element.node.y}
              fill={
                inked
                  ? `color-mix(in oklch, ${tone} 18%, var(--color-fd-secondary))`
                  : 'var(--color-fd-secondary)'
              }
              stroke={inked ? tone : 'var(--color-fd-border)'}
              style={tint}
              initial={false}
              animate={{ r: ring, strokeWidth: touched ? 1.4 : 1 }}
              transition={radius(ring, node, fade)}
            />
            <motion.text
              x={element.node.x}
              y={element.node.y + 4}
              textAnchor="middle"
              fontSize="11.5"
              fontFamily="var(--font-mono, ui-monospace, monospace)"
              fill={inked ? tone : 'var(--color-fd-foreground)'}
              style={tint}
              initial={false}
              animate={{ opacity: shown ? 1 : 0 }}
              transition={fade}
            >
              {element.symbol}
            </motion.text>
            <circle cx={element.node.x} cy={element.node.y} r={ELEMENT_R + 4} fill="transparent" />
          </motion.g>
        );
      })}

      {/* Everything docks here. */}
      <g aria-hidden="true">
        <motion.circle
          // Remounted per beat so the arriving change lands as one pulse.
          key={beat === null ? 'hub' : `hub-${beat.index}`}
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
              : { duration: 0.85, delay: BEAT_MS / 2 / 1000, ease: 'easeOut' }
          }
        />
        <text
          x={C}
          y={C + 4}
          textAnchor="middle"
          fontSize="11.5"
          fontFamily="var(--font-mono, ui-monospace, monospace)"
          fill="var(--color-fd-foreground)"
        >
          okengine
        </text>
      </g>

      {CONCERNS.map((concern, i) => {
        const shown = i < visible;
        const isActive = isActiveConcern(i);
        const isLive = hover === null && changed === i;
        const dimmed = hover !== null && !isActive;
        const lit = isActive || isLive;
        const tone = toneForElementName(concern.element);
        const halo = isActive ? 9.5 : isLive ? 8 : 0;
        const dot = shown ? (isActive ? 4.6 : 3.6) : 0;
        return (
          <motion.g
            key={concern.text}
            tabIndex={shown ? 0 : -1}
            aria-label={`${concern.text} — subsumed by ${concern.element}`}
            onMouseEnter={() => onHover({ kind: 'concern', index: i })}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover({ kind: 'concern', index: i })}
            onBlur={() => onHover(null)}
            initial={false}
            animate={{ opacity: shown ? (dimmed ? 0.45 : 1) : 0 }}
            transition={fade}
            pointerEvents={shown ? 'auto' : 'none'}
            style={{ cursor: shown ? 'pointer' : 'default', outline: 'none' }}
          >
            <motion.circle
              cx={concern.node.x}
              cy={concern.node.y}
              fill={lit ? tone : 'var(--color-fd-foreground)'}
              style={tint}
              initial={false}
              animate={{ r: halo, opacity: isActive ? 0.14 : 0.09 }}
              transition={radius(halo, node, fade)}
            />
            <motion.circle
              cx={concern.node.x}
              cy={concern.node.y}
              fill={lit ? tone : 'var(--color-fd-muted-foreground)'}
              style={tint}
              initial={false}
              animate={{ r: dot }}
              transition={radius(dot, node, fade)}
            />
            <circle cx={concern.node.x} cy={concern.node.y} r="9" fill="transparent" />
          </motion.g>
        );
      })}

      {named === null ? null : (
        <LabelChip
          label={named.label}
          at={named.at}
          reduced={reduced}
          tone={
            hoveredElement
              ? toneForElementName(hoveredElement.name)
              : namedConcern === null
                ? undefined
                : toneForElementName(CONCERNS[namedConcern]!.element)
          }
        />
      )}
    </motion.svg>
  );
}

/**
 * Stepped, tabbed contrast between the infrastructure zoo and the eight
 * elements: one counter grows quadratically, the other linearly.
 */
export function CollapseDiagram() {
  const [tab, setTab] = useState<TabId>('zoo');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [steered, setSteered] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [tick, setTick] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const autoplayed = useRef(false);

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
    const node = containerRef.current;
    if (!node || reduced) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || autoplayed.current) return;
        autoplayed.current = true;
        setPlaying(true);
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

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
  const edges = tab === 'zoo' ? zooSeamCount(visible) : treeEdgeCount(visible);
  const Panel = tab === 'zoo' ? ZooPanel : HubPanel;
  const beat: Beat | null = feeding
    ? { index: tick, concern: changedConcern(tick, visible) }
    : null;
  const readout = readoutFor(tab, visible, shownStep, hover, beat);

  return (
    /*
     * Gate motion in the tree via `reduced` (instant transitions, no scale /
     * change-feed). Keep MotionConfig at `never` so Motion does not refuse
     * transform animates and warn under the OS preference.
     */
    <MotionConfig reducedMotion="never" transition={reduced ? INSTANT : FADE}>
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fd-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2 rounded-full bg-fd-primary ring-2 ring-fd-border"
            />
            <div className="relative h-4 w-20">
              <AnimatePresence initial={false}>
                <motion.span
                  key={tab}
                  initial={reduced ? false : { opacity: 0, y: 5 }}
                  animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -5 }}
                  className="absolute inset-0 font-mono text-[11px] tracking-[0.14em] text-fd-muted-foreground uppercase"
                >
                  {tab === 'zoo' ? 'the zoo' : 'okengine'}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
          <div
            role="tablist"
            aria-label="Backend shape"
            className="flex items-center gap-0.5 rounded-md border border-fd-border p-0.5"
          >
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === tab}
                onClick={() => {
                  setTab(item.id);
                  setHover(null);
                }}
                className={cn(
                  'rounded px-2.5 py-1 font-mono text-[11px] transition-colors',
                  item.id === tab
                    ? 'bg-fd-primary text-fd-primary-foreground'
                    : 'text-fd-muted-foreground hover:text-fd-foreground',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-px bg-fd-border lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="bg-fd-card px-4 py-5 sm:px-6" onMouseLeave={() => setHover(null)}>
            {/* Square cell: both shapes are 420×420, so they crossfade in place. */}
            <div className="relative mx-auto aspect-square w-full max-w-120">
              <AnimatePresence initial={false}>
                <Panel
                  key={tab}
                  visible={visible}
                  hover={hover}
                  onHover={onHover}
                  reduced={reduced}
                  beat={beat}
                />
              </AnimatePresence>
            </div>
          </div>

          <div className="flex flex-col gap-4 bg-fd-card px-4 py-5 sm:px-6">
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground/70 uppercase">
                  concerns
                </dt>
                <dd className="mt-1 font-mono text-2xl leading-none font-medium text-fd-foreground">
                  {visible}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground/70 uppercase">
                  {tab === 'zoo' ? 'seams' : 'edges'}
                </dt>
                <dd className="mt-1 font-mono text-3xl leading-none font-medium text-fd-foreground">
                  <EdgeCount value={edges} reduced={reduced} />
                </dd>
              </div>
            </dl>

            <p
              aria-live="polite"
              className="border-t border-fd-border pt-3 text-sm leading-snug text-fd-foreground"
            >
              {captionFor(tab, shownStep)}
            </p>

            <div className="flex flex-col gap-2 border-t border-fd-border pt-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground/70 uppercase">
                  <span
                    aria-hidden
                    className={cn(
                      'size-1.5 rounded-full',
                      readout.mode === 'live'
                        ? 'animate-pulse bg-fd-primary'
                        : 'bg-fd-muted-foreground/40',
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

            <div className="flex flex-col gap-2 border-t border-fd-border pt-3">
              {PROSE[tab].map((line) => (
                <p key={line} className="text-xs leading-relaxed text-fd-muted-foreground">
                  {line}
                </p>
              ))}
            </div>
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
              label={running ? 'Pause' : atEnd ? 'Replay' : 'Play'}
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
 * The connection counter, rolled rather than swapped: the whole argument is
 * that one of these two numbers climbs far faster than the other, so the climb
 * is worth watching — and switching tabs rolls it back down again.
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
