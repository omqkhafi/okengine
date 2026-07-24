/**
 * `okengine` public entry — kernel surface used by apps and examples.
 *
 * Full ten-export surface lands as elements ship; this entry exposes the
 * executable core (oke · on · flow · http · fx · contracts).
 */

export {
  oke,
  on,
  flow,
  http,
  every,
  internal,
  table,
  fail,
  createFx,
  isFlow,
  isFlowFailure,
  plugin,
  isPlugin,
  type OkeApp,
  type OkeOptions,
  type FlowDef,
  type FlowFailure,
  type FlowErrorValue,
  type Fx,
  type Binding,
  type PluginDef,
  type PluginCapabilities,
} from "./kernel/index.ts";

export {
  store,
  classify,
  id,
  now,
  defineTable,
  createStoreRuntime,
  type StoreDecl,
  type StoreRuntime,
  type SqlStoreHandle,
  type TableHandle,
} from "./elements/store.ts";

export {
  signal,
  createSignalRuntime,
  type SignalDecl,
  type SignalOptions,
  type SignalRuntime,
} from "./elements/signal.ts";

export {
  clock,
  createClockRuntime,
  createTestClockRuntime,
  createTimeTravel,
  runDurable,
  reconcileClocks,
  detectDstAmbiguity,
  type ClockDecl,
  type ClockRuntime,
  type TimeTravel,
  type DurableResult,
} from "./elements/clock.ts";

export {
  gate,
  createGateRuntime,
  takeRate,
  deriveModuleActions,
  ALL_RATE_STRATEGIES,
  type GateDecl,
  type GateRuntime,
  type RateOptions,
} from "./elements/gate.ts";

export {
  vault,
  createVaultRuntime,
  VaultBootError,
  SECRET_MASK,
  type VaultSecretDecl,
  type VaultRuntime,
} from "./elements/vault.ts";

export {
  channel,
  createChannelRuntime,
  createConsentStore,
  createReceiptLedger,
  type ChannelTemplateDecl,
  type ChannelRuntime,
} from "./elements/channel.ts";

export {
  ai,
  createAiRuntime,
  assertAllowPiiForAsk,
  AiPiiBuildError,
  runPromptEvals,
  parseEvalJsonl,
  type AiModelDecl,
  type AiPromptDecl,
  type AiAgentDecl,
  type AiRuntime,
} from "./elements/ai.ts";

export {
  createJournal,
  createMemoryJournalStore,
  createFileJournalStore,
  type Journal,
  type JournalStore,
  type JournalRun,
} from "./kernel/journal.ts";

export {
  validate,
  isStandardSchema,
  fromTypeBox,
  VALIDATION_ERROR_CODE,
  type StandardSchemaV1,
  type SchemaInput,
  type ValidationErrorData,
} from "./validation/index.ts";

export {
  compileAot,
  compileDynamic,
  compileRoute,
  sucrose,
  type CompiledRoute,
  type ContextInference,
} from "./compiler/index.ts";

export {
  createBunRuntime,
  createWebStandardRuntime,
  APP_PORT,
  type Runtime,
  type ServeOptions,
} from "./runtime/index.ts";

export {
  createRunsRuntime,
  collectWideEvent,
  createRunTelemetry,
  explainOutliers,
  seedOutlierDataset,
  privacyErase,
  createMemorySubjectKeys,
  subjectKeysFromVault,
  archiveFields,
  revealArchived,
  eraseSubject,
  SHREDDED,
  filesRunsDriver,
  memoryRunsDriver,
  postgresRunsDriver,
  clickhouseRunsDriver,
  type RunsRuntime,
  type WideEvent,
  type CreateRunsRuntimeOptions,
  type OutlierFinding,
  type SubjectKeyVault,
} from "./runs/index.ts";
