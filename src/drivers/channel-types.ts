/**
 * Protocol-named channel driver contracts.
 *
 * Email transports implement sently's {@link Transport} so sently transports
 * run unchanged. Non-email media expose sently SMS / WhatsApp / Push transports
 * plus a {@link ChannelTransport} adapter for the OKE runtime.
 */

import type { MailOptions, SendResult, Transport, VerifyResult } from "sently";

export type {
  Address,
  AddressInput,
  Attachment,
  MailOptions,
  SendResult,
  Transport,
  VerifyResult,
  Envelope,
  RetryConfig,
} from "sently";

/**
 * Sently-compatible SMS transport (structural — sently keeps `SmsTransport` on
 * internal sms-types; OKE drivers wrap concrete sently transports).
 */
export interface SmsTransport {
  readonly provider?: string;
  send(options: {
    readonly to: string;
    readonly body: string;
    readonly from?: string;
    readonly messageId?: string;
  }): Promise<{
    readonly messageId: string;
    readonly to: string;
    readonly status: string;
    readonly response: string;
    readonly provider?: string;
    readonly providerIndex?: number;
  }>;
  verify?(): Promise<VerifyResult>;
  close?(): Promise<void>;
}

/** Sently-compatible WhatsApp transport (structural). */
export interface WhatsAppTransport {
  readonly provider?: string;
  send(options: unknown): Promise<{
    readonly messageId: string;
    readonly to: string;
    readonly status: string;
    readonly response: string;
    readonly provider?: string;
    readonly providerIndex?: number;
  }>;
  verify?(): Promise<VerifyResult>;
  close?(): Promise<void>;
}

/**
 * Provider-managed OTP vendor extra on an SMS transport (Taqnyat Verify).
 * Kept off the base {@link SmsTransport} surface — only transports that expose
 * these methods support Channel provider OTP.
 */
export interface SmsOtpTransport {
  sendOtp(options: ChannelOtpSendOptions): Promise<ChannelOtpSendResult>;
  verifyOtp(options: ChannelOtpVerifyOptions): Promise<ChannelOtpVerifyResult>;
}

/** Options for {@link SmsOtpTransport.sendOtp} (Taqnyat Verify). */
export interface ChannelOtpSendOptions {
  /** Recipient phone number (E.164). */
  readonly to: string;
  /** Unique id for this verification flow (required again on verify). */
  readonly requestId: string;
  /** Message language (`en` or `ar`). */
  readonly lang?: "en" | "ar";
  /** Optional note appended to the OTP SMS. */
  readonly note?: string;
  /** Sender id override. */
  readonly from?: string;
}

/** Result of a successful provider OTP send. */
export interface ChannelOtpSendResult {
  /** Echo of the {@link ChannelOtpSendOptions.requestId}. */
  readonly requestId: string;
  /** Recipient as passed in. */
  readonly to: string;
  /** Provider status code (`5` = code sent). */
  readonly code: number;
  /** Raw response body text. */
  readonly response: string;
  /** Provider identifier. */
  readonly provider: string;
}

/** Options for {@link SmsOtpTransport.verifyOtp}. */
export interface ChannelOtpVerifyOptions {
  /** Recipient phone number (same as send). */
  readonly to: string;
  /** Same {@link ChannelOtpSendOptions.requestId} used when sending. */
  readonly requestId: string;
  /** OTP code the user entered. */
  readonly code: string;
  /** Message language (`en` or `ar`). */
  readonly lang?: "en" | "ar";
  /** Sender id override. */
  readonly from?: string;
  /** Optional note. */
  readonly note?: string;
}

/** Result of a successful provider OTP check (failures throw). */
export interface ChannelOtpVerifyResult {
  /** Always `true` when the call resolves. */
  readonly ok: true;
  /** Provider status code (`10` = completed; `13`/`19` = already verified). */
  readonly code: number;
  /** Provider message when present. */
  readonly message: string;
  /** Raw response body text. */
  readonly response: string;
  /** Provider identifier. */
  readonly provider: string;
}

/** Sently-compatible push transport (structural). */
export interface PushTransport {
  readonly provider?: string;
  send(options: unknown): Promise<{
    readonly messageId: string;
    readonly status: string;
    readonly response: string;
    readonly provider?: string;
    readonly providerIndex?: number;
  }>;
  verify?(): Promise<VerifyResult>;
  close?(): Promise<void>;
}

/** Protocol ids for channel drivers. */
export type ChannelDriverId =
  | "console"
  | "smtp"
  | "resend"
  | "sndr"
  | "taqnyat"
  | "taqnyat-mail"
  | "taqnyat-whatsapp"
  | "msegat"
  | "unifonic"
  | "wa-cloud"
  | "fcm"
  | "webpush";

/** Channel medium. */
export type ChannelMediumId = "email" | "sms" | "whatsapp" | "push" | "any";

/** Unified outbound message (medium-agnostic). */
export interface ChannelMessage {
  readonly medium: ChannelMediumId;
  readonly to: string;
  readonly from?: string;
  readonly subject?: string;
  readonly text?: string;
  readonly html?: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly locale?: string;
  readonly template?: string;
  /** Raw email options when medium is email (sently-compatible). */
  readonly mail?: MailOptions;
  /** Web Push subscription endpoint + keys. */
  readonly pushSubscription?: {
    readonly endpoint: string;
    readonly keys: { readonly p256dh: string; readonly auth: string };
  };
}

/** Delivery attempt record (fallback chains record every try). */
export interface ChannelAttempt {
  readonly driverId: ChannelDriverId | string;
  readonly ok: boolean;
  readonly error?: string;
  readonly at: number;
  readonly messageId?: string;
}

/** Result of a channel send including chain history. */
export interface ChannelSendResult {
  readonly ok: boolean;
  readonly messageId: string;
  readonly driverId: string;
  readonly attempts: readonly ChannelAttempt[];
  /** Present when an email transport returned a sently {@link SendResult}. */
  readonly mail?: SendResult;
}

/** Medium-agnostic transport (sms / whatsapp / push / console). */
export interface ChannelTransport {
  readonly provider: string;
  readonly mediums: readonly ChannelMediumId[];
  send(message: ChannelMessage): Promise<ChannelSendResult>;
  verify?(): Promise<VerifyResult>;
  close?(): Promise<void>;
}

/**
 * Dual-shape driver: email drivers expose a sently {@link Transport};
 * SMS / WhatsApp / push expose the matching sently transport plus a
 * {@link ChannelTransport} adapter.
 */
export interface ChannelDriver {
  readonly id: ChannelDriverId;
  /** Sently-compatible email transport (smtp / resend / console-email). */
  readonly transport?: Transport;
  /** Sently SMS transport (used by runtime FallbackTransport chains). */
  readonly smsTransport?: SmsTransport;
  /** Sently WhatsApp transport. */
  readonly whatsappTransport?: WhatsAppTransport;
  /** Sently push transport (webpush / fcm). */
  readonly pushTransport?: PushTransport;
  /** Medium-agnostic transport. */
  readonly channel?: ChannelTransport;
}

/** Open options shared by channel drivers. */
export interface ChannelOpenOptions {
  readonly apiKey?: string;
  readonly from?: string;
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly pass?: string;
  readonly url?: string;
  readonly token?: string;
  /** Taqnyat bearer (alias of `token` / `apiKey`). */
  readonly bearerToken?: string;
  /** Msegat account username (alias of `user`). */
  readonly userName?: string;
  /** SMS alphanumeric sender id (alias of `from`). */
  readonly sender?: string;
  /** Unifonic AppSid (alias of `apiKey`). */
  readonly appSid?: string;
  /** FCM / GCP project id (alias of `from`). */
  readonly projectId?: string;
  /** FCM service-account client email. */
  readonly clientEmail?: string;
  /** FCM service-account PEM private key. */
  readonly privateKey?: string;
  /** VAPID keys for webpush. */
  readonly vapidPublicKey?: string;
  readonly vapidPrivateKey?: string;
  readonly vapidSubject?: string;
  /** Taqnyat Email campaign name (required by `mailSend.php`). */
  readonly campaignName?: string;
  /** Injected fetch for HTTP drivers. */
  readonly fetch?: typeof globalThis.fetch;
  /** Dev inbox sink for console driver. */
  readonly inbox?: ChannelInbox;
}

/** Dev inbox entry. */
export interface ChannelInboxEntry {
  readonly id: string;
  readonly medium: ChannelMediumId;
  readonly to: string;
  readonly subject?: string;
  readonly text?: string;
  readonly html?: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly template?: string;
  readonly locale?: string;
  readonly at: number;
}

/** Mutable dev inbox. */
export interface ChannelInbox {
  readonly entries: ChannelInboxEntry[];
  push(entry: ChannelInboxEntry): void;
  clear(): void;
}

/**
 * Create an in-memory inbox for the console driver.
 */
export function createChannelInbox(): ChannelInbox {
  const entries: ChannelInboxEntry[] = [];
  return {
    entries,
    push(entry) {
      entries.push(entry);
    },
    clear() {
      entries.length = 0;
    },
  };
}
