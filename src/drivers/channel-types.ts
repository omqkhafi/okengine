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
