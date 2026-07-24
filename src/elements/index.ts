/**
 * Elements: `signal` · `store` · `clock` · `gate` · `vault` · `channel` · `ai`.
 */

export {
  store,
  sql,
  kv,
  files,
  index,
  classify,
  id,
  now,
  defineTable,
  createStoreRuntime,
  createStoreCache,
  computedCacheKey,
  isReadOnlyStoreFlow,
  sqlRoleForEffects,
  maskRows,
  PII_MASK,
} from "./store.ts";

export type {
  StoreDecl,
  SqlStoreDecl,
  KvStoreDecl,
  FilesStoreDecl,
  IndexStoreDecl,
  StoreRuntime,
  StoreHandle,
  SqlStoreHandle,
  TableHandle,
  ColumnDef,
} from "./store.ts";

export { signal, createSignalRuntime } from "./signal.ts";
export type {
  SignalDecl,
  SignalOptions,
  SignalRuntime,
  CreateSignalRuntimeOptions,
} from "./signal.ts";

export {
  clock,
  createClockRuntime,
  createTestClockRuntime,
  createTimeTravel,
  runDurable,
  reconcileClocks,
  detectDstAmbiguity,
  parseDurationMs,
} from "./clock.ts";
export type {
  ClockDecl,
  ClockOptions,
  ClockRuntime,
  TimeTravel,
  DurableResult,
} from "./clock.ts";

export {
  gate,
  createGateRuntime,
  takeRate,
  deriveModuleActions,
  formatGatesList,
  ALL_RATE_STRATEGIES,
  DEFAULT_RATE_STRATEGY,
} from "./gate.ts";
export type {
  GateDecl,
  GatePolicyContext,
  GateRuntime,
  RateOptions,
  RateTakeResult,
} from "./gate.ts";

export {
  vault,
  createVaultRuntime,
  VaultBootError,
  SECRET_MASK,
  fingerprintSecret,
  fingerprintSecretSync,
  createSecretRedactor,
} from "./vault.ts";
export type {
  VaultSecretDecl,
  VaultSecretOptions,
  VaultRuntime,
  VaultGap,
  VaultChainLayer,
  CreateVaultRuntimeOptions,
} from "./vault.ts";

export {
  channel,
  createChannelRuntime,
  createConsentStore,
  createReceiptLedger,
  SentlyError,
  RetryTransport,
  FallbackTransport,
  FallbackError,
} from "./channel.ts";
export type {
  ChannelTemplateDecl,
  ChannelTemplateOptions,
  ChannelRuntime,
  ChannelSendOptions,
  CreateChannelRuntimeOptions,
  ConsentStore,
  DeliveryReceipt,
  ReceiptLedger,
  Transport,
} from "./channel.ts";

export {
  ai,
  createAiRuntime,
  assertAllowPiiForAsk,
  AiPiiBuildError,
  runPromptEvals,
  parseEvalJsonl,
} from "./ai.ts";
export type {
  AiModelDecl,
  AiPromptDecl,
  AiAgentDecl,
  AiEmbedDecl,
  AiRuntime,
  AgentDenial,
  CreateAiRuntimeOptions,
  EvalCase,
  EvalSuiteResult,
} from "./ai.ts";
