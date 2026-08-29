/**
 * `okengine` public entry — core programming vocabulary + HTTP runtime essentials.
 *
 * Heavy surfaces live on subpaths: `okengine/full`, `okengine/runs`,
 * `okengine/i18n`, `okengine/compiler`, `okengine/journal`, `okengine/http`.
 *
 * @example
 * ```ts
 * import { oke, on, flow, http, gate } from "okengine";
 *
 * export const app = oke({ name: "notes" });
 * ```
 *
 * @module
 */

export {
  oke,
  type OkeApp,
  type OkeOptions,
  type ReadyState,
  type RegisteredFlowUnits,
  type RoutesFromRegisteredUnits,
} from "./kernel/app.ts";
export { on, type Binding } from "./kernel/on.ts";
export { flow, isFlow, type FlowDef } from "./kernel/flow.ts";
export { http, internal, mcp } from "./kernel/triggers.ts";
export { registerFlowUnits } from "./kernel/flow-units.ts";
export { stampFlowName, stampHttpPath } from "./kernel/stamp-http.ts";
export { fail, type FlowFailure, type FlowErrorValue } from "./kernel/errors.ts";
export { isFlowFailure } from "./kernel/hooks.ts";
export { plugin, isPlugin, type PluginDef, type PluginCapabilities } from "./kernel/plugin.ts";
export type { Fx, FxPrincipal, StepOptions } from "./kernel/fx.ts";

export {
  defineLocale,
  defineMessages,
  flattenMessages,
  getMessageCatalogs,
  matchConfiguredLocale,
  translate,
  type MessageCatalog,
  type MessageCatalogs,
} from "./i18n/messages.ts";
export type { AppMessageKey, MessageTree, MessageValues, MessagesFor } from "./i18n/types.ts";
export { runWithLocale, type LocaleContext } from "./i18n/locale-context.ts";
export { isRtlLocale, parseAcceptLanguage, resolveLocale } from "./elements/channel/locale.ts";

export {
  store,
  classify,
  id,
  now,
  nowIso,
  nowDate,
  defineTable,
  field,
  defineSeed,
  normalizeSeedFns,
  resolveSeedCategory,
  resolveSeedIdentity,
  seedPromptMessage,
  createStoreRuntime,
  liveQuery,
  type StoreDecl,
  type StoreRuntime,
  type SqlStoreHandle,
  type InferSelectRow,
  type TableHandle,
  type SchemaTableDecl,
  type SchemaColumnDecl,
  type SeedDef,
  type SeedFn,
  type SeedFns,
  type SeedIdentity,
  type SeedCategory,
  type UpsertResult,
  type UpsertStatus,
} from "./elements/store.ts";

export {
  signal,
  createSignalRuntime,
  type SignalDecl,
  type SignalOptions,
  type SignalRetention,
  type SignalRuntime,
  type DeadLetter,
  type SignalFailureReason,
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
  flattenGateArgs,
  flattenGateMembers,
  isGateAllDecl,
  type GateAllDecl,
  type GateDecl,
  type GateMember,
  type RateOptions,
} from "./elements/gate/declare.ts";
export {
  resolveGateConfig,
  type GateOptions,
  type ResolvedGateConfig,
} from "./elements/gate/config.ts";
export { GateBootError, assertHttpGatePosture, type GatePostureGap } from "./elements/gate/boot.ts";
export { DEFAULT_RATE_STRATEGY, ALL_RATE_STRATEGIES } from "./elements/gate/constants.ts";

export {
  vault,
  fromDocker,
  FROM_DOCKER_PREFIX,
  createVaultRuntime,
  VaultBootError,
  SECRET_MASK,
  listRequiredEnvNames,
  resetRequiredEnvNames,
  type VaultEnvApi,
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
  listAiDecls,
  resetAiDecls,
  createAiRuntime,
  assertAllowPiiForAsk,
  AiPiiBuildError,
  AiSchemaValidationError,
  runPromptEvals,
  parseEvalJsonl,
  type AiModelDecl,
  type AiPromptDecl,
  type AiAgentDecl,
  type AiMcpServerDecl,
  type AiMcpServerOptions,
  type AiRuntime,
} from "./elements/ai.ts";

export {
  createBunRuntime,
  createWebStandardRuntime,
  APP_PORT,
  type Runtime,
  type ServeOptions,
} from "./runtime/index.ts";
