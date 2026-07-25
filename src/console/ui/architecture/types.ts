/**
 * Architecture panel domain types (console §9.13).
 *
 * Second rendering of the Flows causality graph — shape, not which-one.
 */

/** Toggleable element layers — edges are typed, not merely grouped. */
export type ElementLayer = "data" | "messaging" | "time" | "external";

/** All toggleable layers in display order. */
export const ELEMENT_LAYERS: readonly ElementLayer[] = [
  "data",
  "messaging",
  "time",
  "external",
] as const;

/** Human labels for element layers. */
export const LAYER_LABEL: Readonly<Record<ElementLayer, string>> = {
  data: "Data",
  messaging: "Messaging",
  time: "Time",
  external: "External",
};

/** Node kinds on the architecture diagram. */
export type ArchitectureNodeKind =
  | "unit"
  | "flow"
  | "resource"
  | "external";

/**
 * One node on the architecture diagram.
 *
 * Default view uses unit clusters; focus expands flows / resources at depth.
 */
export interface ArchitectureNode {
  /** Stable id (`unit:bookings`, `flow:bookings.create`, `sql:bookings`). */
  readonly id: string;
  /** Visual / semantic kind. */
  readonly kind: ArchitectureNodeKind;
  /** Human label. */
  readonly label: string;
  /** Owning unit when applicable. */
  readonly unit?: string;
  /** Element layer for resources (typed edges). */
  readonly layer?: ElementLayer;
  /** True when inside the drawn system boundary. */
  readonly insideBoundary: boolean;
  /** Flow count for unit clusters. */
  readonly flowCount?: number;
  /** True when this node is the current focus. */
  readonly focused?: boolean;
  /** Hop distance from focus (0 = focus). */
  readonly depth?: number;
}

/**
 * One declared (and optionally observed) edge.
 *
 * Thickness comes from Runs traffic; dashed means declared but never traversed.
 */
export interface ArchitectureEdge {
  /** Stable id. */
  readonly id: string;
  /** Source node id. */
  readonly from: string;
  /** Target node id. */
  readonly to: string;
  /**
   * Element layer, or `call` for structural flow→flow portals
   * (always shown; not behind a layer toggle).
   */
  readonly layer: ElementLayer | "call";
  /** Declared in the Manifest / causality graph. */
  readonly declared: boolean;
  /** Observed traversals from Runs. */
  readonly traversals: number;
  /** `declared && traversals === 0` — dead relationship. */
  readonly dashed: boolean;
  /** Stroke weight 1–8 from relative traffic. */
  readonly thickness: number;
  /** Aggregated across flows when clustered by unit. */
  readonly aggregated: boolean;
}

/** Computed pathology kinds (findings list, not decoration). */
export type PathologyKind =
  | "cycle"
  | "god-node"
  | "orphan-signal"
  | "spof";

/** One diagnostic finding from the graph-as-data. */
export interface ArchitectureFinding {
  /** Pathology class. */
  readonly kind: PathologyKind;
  /** Ranking hint for Overview union. */
  readonly severity: "warning" | "critical";
  /** Short title. */
  readonly title: string;
  /** Plain-language detail. */
  readonly detail: string;
  /** Related node ids. */
  readonly nodeIds: readonly string[];
}

/** Focus depth — neighbourhood hops from the selected node. */
export type FocusDepth = 1 | 2;

/** Layer visibility map. */
export type LayerFlags = Readonly<Record<ElementLayer, boolean>>;

/** Default: every typed layer on. */
export const DEFAULT_LAYERS: LayerFlags = {
  data: true,
  messaging: true,
  time: true,
  external: true,
};

/**
 * Fully projected architecture view for one Manifest + Runs population.
 */
export interface ArchitectureView {
  /** Visible nodes (clustered or focused neighbourhood). */
  readonly nodes: readonly ArchitectureNode[];
  /** Visible edges after layer + focus filters. */
  readonly edges: readonly ArchitectureEdge[];
  /**
   * Distinct Manifest external effects (channel/ai) that flows touch —
   * the boundary-crossing metric (§9.13).
   */
  readonly boundaryCrossingCount: number;
  /** Computed pathologies. */
  readonly findings: readonly ArchitectureFinding[];
  /** Current focus node id, or null for unit-cluster overview. */
  readonly focus: string | null;
  /** Neighbourhood depth when focused. */
  readonly depth: FocusDepth;
  /** Active element layers. */
  readonly layers: LayerFlags;
}
