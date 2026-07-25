/**
 * Signals panel pure modules (console §9.4).
 */

export type {
  SignalDelivery,
  SignalDeadLetter,
  SignalEndpoint,
  SignalFailure,
  SignalPhysicsGroup,
  SignalRecord,
} from "./types.ts";

export {
  parseSignalsSearch,
  serializeSignalsSearch,
  openSignal,
  closeSignal,
  openDeadLetter,
  closeDeadLetter,
  type SignalsSearch,
} from "./search.ts";

export { groupByPhysics } from "./group.ts";
export { durableLine, type DurableLine } from "./durable.ts";
export {
  replayConfirmation,
  discardConfirmation,
  validateTypedConfirm,
  UNDO_WINDOW_MS,
  type ConfirmationPattern,
} from "./confirmation.ts";
export {
  fieldsFromSchema,
  payloadToFormValues,
  formValuesToPayload,
  type SchemaField,
} from "./schema-form.ts";
export {
  createLiveMonitor,
  appendLivePayload,
  setPaused,
  onMonitorScroll,
  exportLivePayloads,
  type LiveMonitorState,
} from "./monitor.ts";
export { SIGNALS_FIXTURE } from "./fixture.ts";
export { dryRunOffer, type DryRunOffer } from "./dry-run.ts";
