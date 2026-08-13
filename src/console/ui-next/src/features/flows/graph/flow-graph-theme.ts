/**
 * Flow graph visual tokens — one palette for node accents + effect-edge colors.
 *
 * Tuned for the Console dark canvas (dot-grid on near-black). Hex (not
 * theme CSS vars) so SVG edge strokes stay stable across light/dark.
 */

/** Declared effect / relationship kinds drawn as edges. */
export type FlowGraphEdgeKind = "reads" | "writes" | "emits" | "calls" | "asks" | "trigger";

/** Leaf node kinds that carry an accent (unit groups are chrome only). */
export type FlowGraphAccentKind = "flow" | "store" | "signal" | "ai";

/** Per-node-kind accent — border, icon well, selection glow. */
export const NODE_ACCENT: Record<
  FlowGraphAccentKind,
  { readonly accent: string; readonly glow: string; readonly well: string }
> = {
  flow: {
    accent: "#38BDF8",
    glow: "rgba(56, 189, 248, 0.45)",
    well: "rgba(56, 189, 248, 0.14)",
  },
  store: {
    accent: "#34D399",
    glow: "rgba(52, 211, 153, 0.45)",
    well: "rgba(52, 211, 153, 0.14)",
  },
  signal: {
    accent: "#FBBF24",
    glow: "rgba(251, 191, 36, 0.4)",
    well: "rgba(251, 191, 36, 0.14)",
  },
  ai: {
    accent: "#FB7185",
    glow: "rgba(251, 113, 133, 0.45)",
    well: "rgba(251, 113, 133, 0.14)",
  },
};

/**
 * Effect-edge stroke colors — distinct hues, not dashed-vs-solid alone.
 * `asks` shares the AI node accent; `trigger` shares the signal/emits hue.
 */
export const EDGE_STROKE: Record<FlowGraphEdgeKind, string> = {
  reads: "#2DD4BF",
  writes: "#FB923C",
  emits: "#FBBF24",
  calls: "#60A5FA",
  asks: "#FB7185",
  trigger: "#FBBF24",
};

/** Measured leaf-node box used by the layout pass (matches rendered chrome). */
export const NODE_BOX = {
  flow: { width: 188, height: 52 },
  store: { width: 168, height: 48 },
  signal: { width: 168, height: 48 },
  ai: { width: 168, height: 48 },
} as const;

/** Unit group label band + padding around child flows. */
export const UNIT_CHROME = {
  headerH: 26,
  padX: 10,
  padBottom: 10,
} as const;
