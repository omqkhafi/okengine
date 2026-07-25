/**
 * Architecture panel pure modules (console §9.13).
 */

export type {
  ArchitectureEdge,
  ArchitectureFinding,
  ArchitectureNode,
  ArchitectureNodeKind,
  ArchitectureView,
  ElementLayer,
  FocusDepth,
  LayerFlags,
  PathologyKind,
} from "./types.ts";

export {
  DEFAULT_LAYERS,
  ELEMENT_LAYERS,
  LAYER_LABEL,
} from "./types.ts";

export {
  isBoundaryExternal,
  labelOfRef,
  layerOfCause,
  layerOfEffectRef,
} from "./layers.ts";

export {
  boundaryCrossingCount,
  boundaryCrossingRefs,
} from "./boundary.ts";

export {
  normalizeTrafficRef,
  observeTraffic,
  thicknessOf,
  trafficEdgeKey,
  traversalsOf,
} from "./traffic.ts";

export {
  declaredEdgesOf,
  ownerUnitOf,
  unitOfFlowId,
} from "./declared.ts";

export {
  computePathologies,
  findCycles,
  findGodNodes,
  findOrphanSignals,
  findSinglePointsOfFailure,
} from "./pathologies.ts";

export {
  buildArchitectureView,
  setLayer,
  type ArchitectureViewOptions,
} from "./view.ts";

export {
  clearFocus,
  focusNode,
  layersOf,
  parseArchitectureSearch,
  serializeArchitectureSearch,
  setDepth,
  setLayerSearch,
  type ArchitectureSearch,
} from "./search.ts";

export {
  ARCHITECTURE_RUNS_FIXTURE,
  ARCHITECTURE_TEST_MANIFEST,
} from "./fixture.ts";

export {
  layoutNodes,
  SYSTEM_BOUNDARY,
  type BoundaryRect,
  type NodePosition,
} from "./layout.ts";
