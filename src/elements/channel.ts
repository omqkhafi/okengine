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
  createReceiptLedger,
  type DeliveryReceipt,
  type ReceiptLedger,
} from "./channel/receipts.ts";

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
