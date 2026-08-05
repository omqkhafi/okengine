/**
 * `okengine` public entry — kernel surface used by apps and examples.
 *
 * Full ten-export surface lands as elements ship; this entry exposes the
 * executable core (oke · on · flow · http · fx · contracts).
 *
 * @example
 * ```ts
 * import { oke, on, flow, http } from "okengine";
 *
 * export const app = oke({ name: "notes" });
 * ```
 *
 * @module
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
  bootApplication,
  mintCapabilities,
  gateDenialFailure,
  journey,
  unit,
  rateLimit,
  Redacted,
  isRedacted,
  maskRedactedDeep,
  REDACTED_PLACEHOLDER,
  PluginNeedsError,
  assertPluginNeeds,
  freezePrincipal,
  installGracefulShutdown,
  releaseInstanceLeases,
  type OkeApp,
  type OkeOptions,
  type ReadyState,
  type FlowDef,
  type FlowFailure,
  type FlowErrorValue,
  type Fx,
  type FxPrincipal,
  type Binding,
  type PluginDef,
  type PluginCapabilities,
  type BootOptions,
  type BootResult,
  type ElementRuntimes,
  type JourneyDecl,
  type UnitBag,
} from "./kernel/index.ts";

export {
  store,
  classify,
  id,
  now,
  defineTable,
  field,
  defineSeed,
  normalizeSeedFns,
  resolveSeedCategory,
  createStoreRuntime,
  type StoreDecl,
  type StoreRuntime,
  type SqlStoreHandle,
  type TableHandle,
  type SchemaTableDecl,
  type SchemaColumnDecl,
  type SeedDef,
  type SeedFn,
  type SeedFns,
  type SeedCategory,
  type UpsertResult,
  type UpsertStatus,
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
  GATE_PUBLIC_NAME,
  GateBootError,
  assertHttpGatePosture,
  createGateRuntime,
  resolveGateConfig,
  takeRate,
  deriveModuleActions,
  ALL_RATE_STRATEGIES,
  type GateDecl,
  type GateOptions,
  type GatePostureGap,
  type GateRuntime,
  type RateOptions,
  type ResolvedGateConfig,
} from "./elements/gate.ts";

export {
  vault,
  fromDocker,
  FROM_DOCKER_PREFIX,
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
  createSuppressionStore,
  createReceiptLedger,
  type ChannelTemplateDecl,
  type ChannelRuntime,
} from "./elements/channel.ts";

export {
  ai,
  createAiRuntime,
  assertAllowPiiForAsk,
  AiPiiBuildError,
  AiSchemaValidationError,
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
  hasJournalLease,
  isJournalLeaseBusy,
  JournalLeaseBusy,
  JOURNAL_DEFAULT_LEASE_MS,
  type Journal,
  type JournalLeaseOptions,
  type JournalLeaseStore,
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
  defineLocale,
  defineMessages,
  flattenMessages,
  formatMessage,
  getMessageCatalogs,
  interpolateMessage,
  isRtlLocale,
  matchConfiguredLocale,
  parseAcceptLanguage,
  resolveFailureMessage,
  resolveLocale,
  runWithLocale,
  translate,
  type AppMessageKey,
  type FlattenKeys,
  type LocaleContext,
  type MessageCatalog,
  type MessageCatalogs,
  type MessageTree,
  type MessageValue,
  type MessageValues,
  type MessagesFor,
  type Register,
} from "./i18n/index.ts";

export {
  createBunRuntime,
  createWebStandardRuntime,
  APP_PORT,
  CONSOLE_PORT,
  MCP_PORT,
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
