/**
 * Channel element — reaching humans.
 *
 * Physics: email · SMS · WhatsApp · push.
 * Drivers: `console` · `smtp` · `resend` · `unifonic` · `wa-cloud` · `fcm` · `webpush`.
 *
 * Transport interface is identical to sently's so its transports run unchanged.
 * MIME, attachments, retry, and the unified error hierarchy come from sently.
 * OKE adds: declared templates with i18n, consent/opt-out, fallback chains
 * recorded as chains, and delivery receipts.
 * @module
 */

export { channel } from "./channel/declare.ts";
export type {
  ChannelMediumBinder,
  ChannelMediumOptions,
  ChannelTemplateDecl,
  ChannelTemplateOptions,
} from "./channel/declare.ts";

export {
  createChannelRuntime,
} from "./channel/runtime.ts";
export type {
  ChannelRuntime,
  ChannelSendOptions,
  CreateChannelRuntimeOptions,
  TemplateCatalog,
} from "./channel/runtime.ts";

export {
  createConsentStore,
  type ConsentStore,
  type OptOut,
} from "./channel/consent.ts";

export {
  createSuppressionStore,
  type SuppressionEntry,
  type SuppressionReason,
  type SuppressionStore,
} from "./channel/suppression.ts";

export {
  createReceiptLedger,
  type DeliveryReceipt,
  type DeliveryStatus,
  type IngestOutcomeInput,
  type ReceiptLedger,
} from "./channel/receipts.ts";

export {
  buildOutcomeRows,
  CONSEQUENCE_WEIGHT,
  DELIVERY_OUTCOME_STATES,
  formatAttemptChain,
  isDeliveryOutcomeState,
  rankByConsequence,
  VERDICT_BY_STATE,
  type DeliveryOutcomeState,
  type DeliveryVerdict,
  type OutcomeRow,
} from "./channel/outcomes.ts";

export {
  formatLocaleChain,
  isRtlLocale,
  parseAcceptLanguage,
  resolveLocale,
  type LocaleChainStep,
  type LocaleResolution,
  type ResolveLocaleOptions,
} from "./channel/locale.ts";

export {
  costOf,
  DEFAULT_MEDIUM_COSTS,
  fallbackWeeklyCostDelta,
  type FallbackWeeklyCostDelta,
  type MediumCosts,
} from "./channel/costs.ts";

export {
  CHANNEL_PII_MASK,
  maskEmail,
  maskPhone,
  maskRecipient,
} from "./channel/mask.ts";

export {
  domainFromFrom,
  verifyEmailAuth,
  type AuthCheckStatus,
  type DnsTxtLookup,
  type EmailAuthResult,
  type VerifyEmailAuthOptions,
} from "./channel/email-auth.ts";

export {
  SentlyError,
  RetryTransport,
  FallbackTransport,
  FallbackError,
  type Attachment,
  type MailOptions,
  type SendResult,
  type Transport,
  type FallbackAttempt,
} from "./channel/mime.ts";
