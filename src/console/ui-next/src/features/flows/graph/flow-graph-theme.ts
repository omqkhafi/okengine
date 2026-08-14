/**
 * Flow graph visual tokens — one palette for node accents + effect-edge colors.
 *
 * Tuned for the Console dark canvas (dot-grid on near-black). Hex (not
 * theme CSS vars) so SVG edge strokes stay stable across light/dark.
 */

import type { OkeElement } from "@/lib/element-icons.ts";

/** Declared effect / relationship kinds drawn as edges. */
export type FlowGraphEdgeKind =
  | "reads"
  | "writes"
  | "emits"
  | "calls"
  | "asks"
  | "sends"
  | "secrets"
  | "gates"
  | "trigger"
  | "couple";

/** Leaf + hub kinds that carry an accent (unit groups are chrome only). */
export type FlowGraphAccentKind = OkeElement;

/** Per-element accent — border, icon well, selection glow. */
export const NODE_ACCENT: Record<
  FlowGraphAccentKind,
  { readonly accent: string; readonly glow: string; readonly well: string }
> = {
  flow: {
    accent: "#38BDF8",
    glow: "rgba(56, 189, 248, 0.45)",
    well: "rgba(56, 189, 248, 0.14)",
  },
  signal: {
    accent: "#FBBF24",
    glow: "rgba(251, 191, 36, 0.4)",
    well: "rgba(251, 191, 36, 0.14)",
  },
  store: {
    accent: "#34D399",
    glow: "rgba(52, 211, 153, 0.45)",
    well: "rgba(52, 211, 153, 0.14)",
  },
  clock: {
    accent: "#818CF8",
    glow: "rgba(129, 140, 248, 0.45)",
    well: "rgba(129, 140, 248, 0.14)",
  },
  gate: {
    accent: "#A78BFA",
    glow: "rgba(167, 139, 250, 0.45)",
    well: "rgba(167, 139, 250, 0.14)",
  },
  vault: {
    accent: "#94A3B8",
    glow: "rgba(148, 163, 184, 0.4)",
    well: "rgba(148, 163, 184, 0.14)",
  },
  channel: {
    accent: "#C084FC",
    glow: "rgba(192, 132, 252, 0.45)",
    well: "rgba(192, 132, 252, 0.14)",
  },
  ai: {
    accent: "#FB7185",
    glow: "rgba(251, 113, 133, 0.45)",
    well: "rgba(251, 113, 133, 0.14)",
  },
};

/**
 * Effect-edge stroke colors — distinct hues, not dashed-vs-solid alone.
 * `asks` shares the AI node accent; `trigger` shares the signal/emits hue;
 * `sends` / `secrets` / `gates` share their element accents.
 * `couple` is the idle overview stroke — muted, low-contrast. Hover
 * / selection paints the destination element accent.
 */
export const EDGE_STROKE: Record<FlowGraphEdgeKind, string> = {
  reads: "#2DD4BF",
  writes: "#FB923C",
  emits: "#FBBF24",
  calls: "#60A5FA",
  asks: "#FB7185",
  sends: "#C084FC",
  secrets: "#94A3B8",
  gates: "#A78BFA",
  trigger: "#FBBF24",
  couple: "#64748B",
};

/** Measured leaf-node box used by the layout pass (matches rendered chrome). */
export const NODE_BOX = {
  flow: { width: 188, height: 52 },
  store: { width: 168, height: 48 },
  signal: { width: 168, height: 48 },
  ai: { width: 168, height: 48 },
  clock: { width: 168, height: 48 },
  gate: { width: 168, height: 48 },
  vault: { width: 168, height: 48 },
  channel: { width: 168, height: 48 },
} as const;

/** Overview map boxes — law disc, element discs, type pills, unit chips. */
export const MAP_BOX = {
  law: { width: 140, height: 140 },
  hub: { width: 76, height: 76 },
  type: { width: 64, height: 26 },
  unit: { width: 128, height: 40 },
} as const;

/** Radial hub geometry (React Flow px). Center is the law. */
export const HUB_LAYOUT = {
  cx: 900,
  cy: 900,
  elementRing: 280,
  /** First type row — just outside the element disc. */
  typeRing: 418,
  /** Second type row — wider than a chip so 2×2 clusters do not merge. */
  typeRow: 88,
  spokeRing: 840,
} as const;

/** Unit group label band + padding around child flows. */
export const UNIT_CHROME = {
  headerH: 26,
  padX: 10,
  padBottom: 10,
} as const;

/**
 * Manual xyflow stack — edges stay under every card.
 *
 * Default `basic` mode lifts edges that leave a parented flow so they
 * clear the unit chrome. That same lift paints the ribbon *over*
 * destination ships (store / signal / AI) and neighboring units.
 */
export const GRAPH_Z = {
  edge: 0,
  unit: 1,
  leaf: 2,
} as const;
