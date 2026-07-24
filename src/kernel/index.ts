/**
 * Kernel: `on` · `flow` · `fx` · effect system · hooks · router.
 *
 * This package exports the effect system (`fx`, ledger, capabilities, errors).
 * `on` / `flow` / hooks / router land in later sessions.
 */

export {
  createCapabilityToken,
  effectsFieldOf,
  type CapabilityToken,
} from "./capability.ts";

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
  createFx,
  createFxContext,
  resolveName,
  resolveStoreRef,
  type CreateFxOptions,
  type Fx,
  type FxAskOptions,
  type FxAuth,
  type FxCache,
  type FxClock,
  type FxContext,
  type FxLog,
  type FxOperator,
  type FxSearchOptions,
  type FxSendOptions,
  type FxStoreHandle,
  type FxTenant,
  type NamedRef,
} from "./fx.ts";
