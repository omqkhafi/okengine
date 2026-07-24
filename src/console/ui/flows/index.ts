/**
 * Flows panel — causality view logic (console §9.1 · §9.2).
 *
 * Pure modules live here so `bun test src/console/ui/flows` gates behaviour
 * without mounting the full SPA.
 */

export {
  createRowBuffer,
  matchesQuery,
  type BufferedRow,
  type RowBuffer,
} from "./buffer.ts";
export {
  confirmationFor,
  createUndoStack,
  UNDO_WINDOW_MS,
  validateTypedConfirm,
  type ConfirmationPattern,
  type TypedConfirmErrors,
  type TypedConfirmInput,
  type UndoEntry,
} from "./confirmation.ts";
export {
  diffAgainstSchema,
  fieldsFromSchema,
  getAtPath,
  parseJsonEditor,
  seedFromSchema,
  setAtPath,
  validateContract,
  valueToJsonText,
  type ContractValidation,
  type FieldError,
  type FormField,
} from "./contract.ts";
export {
  actionOf,
  buildCausalityGraph,
  causeIdsFor,
  centreFlows,
  effectRefsOf,
  leftCauses,
  rightEffects,
  unitOf,
  type CauseNode,
  type CausalityGraph,
  type EffectNode,
  type FlowNode,
} from "./graph.ts";
export {
  emitSaveAsTest,
  saveAsTestPath,
  writeSaveAsTest,
  type SaveAsTestInput,
} from "./save-as-test.ts";
export {
  closeDrawer,
  FlowsSearchSchema,
  joinPath,
  openDrawer,
  parseFlowsSearch,
  parsePath,
  selectCause,
  selectEffect,
  selectFlow,
  serializeFlowsSearch,
  type AttentionFilter,
  type CauseGrouping,
  type CauseKind,
  type Density,
  type DrawerMode,
  type EffectKindKey,
  type FlowGrouping,
  type FlowsSearch,
  type FlowsSelectionKind,
} from "./search.ts";
export {
  EXTERNAL_ACCENT_VAR,
  hasExternalEffect,
  peakEffectTier,
  TIER_LABEL,
  TIER_ORDER,
  tierEffects,
  type TieredEffect,
  type UiEffectTier,
} from "./tiers.ts";
