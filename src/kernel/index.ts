/**
 * Kernel: `on` · `flow` · `fx` · effect system · hooks · router · `oke` · `plugin`.
 */

export {
  oke,
  type CdcPayload,
  type ExecuteResult,
  type OkeApp,
  type OkeOptions,
  type ReadyState,
  type UnitHooks,
} from "./app.ts";

export {
  installGracefulShutdown,
  releaseInstanceLeases,
  type GracefulShutdownApp,
  type InstallGracefulShutdownOptions,
} from "./graceful-shutdown.ts";

export { mintInstanceId, resolveInstanceId, INSTANCE_ID_PREFIX } from "./instance-id.ts";

export {
  createFileInstanceStore,
  createInstanceRuntime,
  createMemoryInstanceStore,
  projectInstancesList,
  INSTANCE_HEARTBEAT_MS,
  INSTANCE_LEASE_MS,
  type CreateInstanceRuntimeOptions,
  type InstanceClockLease,
  type InstanceDetail,
  type InstanceJournalLease,
  type InstanceRow,
  type InstanceRuntime,
  type InstanceStore,
  type InstancesList,
  type InstancesListEmpty,
  type InstancesListFleet,
  type ProjectInstancesListOptions,
} from "./instances.ts";

export {
  bootApplication,
  mintCapabilities,
  resolveElementNeeds,
  type BootOptions,
  type BootResult,
  type ElementNeeds,
  type ElementRuntimes,
} from "./boot.ts";

export {
  applyPrincipal,
  createElementPipelineHooks,
  gateDenialFailure,
  gateNamesOf,
  policyContextOf,
  recordGateEvaluations,
  type GateDenialCode,
  type PipelineDeps,
  type PrincipalBag,
  type ResolvedPrincipal,
} from "./pipeline.ts";

export {
  apiKeyRowToPrincipal,
  claimsToPrincipal,
  createAppAuthBinding,
  verifyBearerOrApiKey,
  verifyBearerToken,
  type AppAuthBinding,
  type CreateAppAuthBindingOptions,
} from "./auth-resolve.ts";

export type {
  AppFlowRoute,
  AppRouteMap,
  FlowNamespace,
  RouteFromFlow,
  RoutesFromAdoptArgs,
} from "./adopt-routes.ts";

export { createCapabilityToken, effectsFieldOf, type CapabilityToken } from "./capability.ts";

export {
  createEffectLedger,
  EFFECT_KIND_TIERS,
  recordEffect,
  reversibilityOf,
  type EffectEntry,
  type EffectKind,
  type EffectLedger,
  type ReversibilityTier,
} from "./effects.ts";

export {
  createRunTelemetry,
  cacheDimensionOf,
  type RunLogLine,
  type RunTelemetry,
} from "./run-telemetry.ts";

export {
  fail,
  formatOkeMessage,
  lookupOkeError,
  OKE_ERRORS,
  OkeError,
  throwOke,
  type FailOptions,
  type FlowErrorValue,
  type FlowFailure,
  type OkeErrorCode,
  type OkeErrorDefinition,
  type OkeErrorParams,
} from "./errors.ts";

export {
  flow,
  flowBrand,
  isFlow,
  resetFlowSeq,
  type AnyFlowDef,
  type FlowDef,
  type FlowErrorMap,
  type FlowHandler,
  type FlowOptions,
  type SchemaInput,
  type StandardSchemaResult,
  type StandardSchemaV1,
} from "./flow.ts";

export {
  createFx,
  createFxContext,
  freezePrincipal,
  isJsonResult,
  isJsonStreamResult,
  jsonResultBrand,
  resolveName,
  resolveStoreRef,
  type CreateFxOptions,
  type Fx,
  type FxAskOptions,
  type FxAuth,
  type FxCache,
  type FxCallHandler,
  type FxClock,
  type FxContext,
  type FxJson,
  type FxLog,
  type FxOperator,
  type FxPrincipal,
  type FxRetryOptions,
  type FxSearchOptions,
  type FxSendOptions,
  type FxStoreHandle,
  type FxTenant,
  type FxThunk,
  type JsonPage,
  type JsonResult,
  type JsonStreamResult,
  type NamedRef,
  type StepOptions,
} from "./fx.ts";

export { listPage } from "./list-page.ts";
export type {
  CursorMeta,
  CursorPage,
  ListQuery,
  OffsetMeta,
  OffsetPage,
  Page,
  PageMeta,
  PageMetaBase,
  PageMode,
  PagerLink as ListPagerLink,
  QueryPageSpec,
} from "./list-page.ts";

export {
  abortError,
  abortableSleep,
  currentAbortSignal,
  isAbortError,
  linkAbort,
  withAbortSignal,
} from "./abort-scope.ts";

export {
  defaultRetryWhen,
  fxAll,
  fxRace,
  fxRetry,
  fxUsing,
  resolveRetryDelayMs,
} from "./concurrency.ts";

export { isRedacted, maskRedactedDeep, REDACTED_PLACEHOLDER, Redacted } from "./redacted.ts";

export {
  DryRunWriteIsolationError,
  dryRunWouldHaveFired,
  getDryRunContext,
  isDryRun,
  recordWouldHaveFired,
  setDryRunMessageId,
  touchDryRunStore,
  withDryRun,
  type DryRunContext,
  type DryRunWouldHaveFired,
} from "./dry-run.ts";

export {
  createJournal,
  createMemoryJournalStore,
  createFileJournalStore,
  hasJournalLease,
  isJournalLeaseBusy,
  isJournalRegistrationComplete,
  isJournalSuspend,
  JournalLeaseBusy,
  JournalRegistrationComplete,
  JournalSuspend,
  JOURNAL_DEFAULT_LEASE_MS,
  JOURNAL_UNDO_PREFIX,
  type Journal,
  type JournalEntry,
  type JournalLeaseOptions,
  type JournalLeaseStore,
  type JournalRun,
  type JournalRunStatus,
  type JournalSession,
  type JournalStepOptions,
  type JournalStore,
  type JournalUndoFrame,
  type CreateJournalOptions,
} from "./journal.ts";

export {
  failureCodeOf,
  failureFromUnknown,
  forwardCompletedSteps,
  rebindUndosFromDo,
  runCompensationPhase,
  type RunCompensationPhaseOptions,
} from "./compensate.ts";

export {
  AFTER_HANDLER_STAGES,
  BEFORE_HANDLER_STAGES,
  HOOK_STAGES,
  isFlowFailure,
  mergeHooks,
  runPipeline,
  type HookFn,
  type HookMap,
  type HookStage,
  type InvocationContext,
  type PipelineResult,
} from "./hooks.ts";

export {
  HOOK_PLUGIN_ID,
  allHookCostSummaries,
  hookCostSummary,
  listHookCostSamples,
  pluginIdOfHook,
  recordHookCost,
  resetHookCosts,
  tagHookWithPlugin,
  type HookCostSample,
  type HookCostSummary,
} from "./hook-timing.ts";

export { listBindings, on, resetBindings, type Binding } from "./on.ts";

export {
  isPlugin,
  plugin,
  type CliContribution,
  type ClientExtensionContribution,
  type ConsolePanelContribution,
  type DecorationsOf,
  type DriverContribution,
  type ImageRecipeContribution,
  type PluginApi,
  type PluginCapabilities,
  type PluginDef,
  type PluginElement,
  type PluginIdentity,
  type PluginOptions,
  type PluginRegistration,
  type TableContribution,
  type PluginTableMeta,
  type PluginTableOptions,
} from "./plugin.ts";

export {
  appPluginScope,
  applyPlugin,
  flowPluginScope,
  unitPluginScope,
  type AccumulateDecorations,
  type Pluggable,
} from "./plug.ts";

export {
  createPluginRegistry,
  createRecordingApi,
  samePluginConfig,
  type InstalledPlugin,
  type PluginRegistry,
  type PluginScope,
} from "./registry.ts";

export {
  assertPluginNeeds,
  buildAvailableNeedTokens,
  collectUnmetPluginNeeds,
  PluginNeedsError,
  ELEMENT_NEED_TOKENS,
  type PluginNeedGap,
  type PluginNeedsContext,
} from "./plugin-needs.ts";

export {
  createRouter,
  formatAllowHeader,
  isUnsupportedByRegExp,
  LinearRouter,
  RegExpRouter,
  SmartRouter,
  sortAllowMethods,
  TrieRouter,
  UnsupportedPathError,
  type RouteMatch,
  type Router,
  type RouterFactory,
  type RouterPreset,
} from "./router.ts";

export {
  asSignalTrigger,
  every,
  http,
  internal,
  isResourceMount,
  isSignalTriggerSource,
  normalizeTrigger,
  table,
  type BoundTriggerOf,
  type CdcTrigger,
  type EveryTrigger,
  type GateRef,
  type HttpMethod,
  type HttpTrigger,
  type InternalTrigger,
  type LiveHttpTrigger,
  type ResourceFlowBag,
  type ResourceMount,
  type SignalAsTrigger,
  type SignalSource,
  type TableHandle,
  type Trigger,
  type TriggerKind,
} from "./triggers.ts";

export {
  journey,
  listJourneys,
  resetJourneys,
  type JourneyDecl,
  type JourneyOptions,
  type JourneySlo,
} from "./journey.ts";

export { unit, consumeUnitPlugins, resetUnitPlugins, type UnitBag } from "./unit.ts";

export { rateLimit, type RateLimitPluginOptions } from "./rate-limit.ts";
