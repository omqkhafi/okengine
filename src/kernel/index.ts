/**
 * Kernel: `on` · `flow` · `fx` · effect system · hooks · router · `oke` · `plugin`.
 */

export {
  oke,
  type CdcPayload,
  type ExecuteResult,
  type OkeApp,
  type OkeOptions,
  type UnitHooks,
} from "./app.ts";

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
  claimsToPrincipal,
  createAppAuthBinding,
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
  type JsonResult,
  type NamedRef,
} from "./fx.ts";

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
  isJournalSuspend,
  JournalSuspend,
  type Journal,
  type JournalEntry,
  type JournalRun,
  type JournalRunStatus,
  type JournalSession,
  type JournalStore,
  type CreateJournalOptions,
} from "./journal.ts";

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
  isUnsupportedByRegExp,
  LinearRouter,
  RegExpRouter,
  SmartRouter,
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
