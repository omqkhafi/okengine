/**
 * Channels panel view types (console §9.9).
 */

/** Panel face. */
export type ChannelsFace = "inbox" | "deliverability";

/** Seven-state taxonomy. */
export type DeliveryOutcomeState =
  | "suppressed/opted-out"
  | "suppressed/prior-bounce"
  | "blocked/invalid-address"
  | "soft-bounce"
  | "hard-bounce"
  | "provider-error"
  | "delivered-then-complained";

/** Verdict beside each count. */
export type DeliveryVerdict = "correct" | "retry" | "suppress" | "review";

/** Outcome row from `console.channel.list`. */
export interface OutcomeRow {
  readonly state: DeliveryOutcomeState;
  readonly count: number;
  readonly verdict: DeliveryVerdict;
  readonly weight: number;
}

/** Template row. */
export interface ChannelTemplate {
  readonly name: string;
  readonly description?: string;
  readonly medium: string;
  readonly locales: readonly string[];
  readonly from: string | null;
  readonly schema: unknown;
}

/** Fallback financial metric. */
export interface FallbackMetric {
  readonly template: string | null;
  readonly chainExample: string;
  readonly fallbackRate: number;
  readonly fallbackCount: number;
  readonly totalCount: number;
  readonly weeklyDeltaUsd: number;
  readonly primaryMedium: string;
  readonly fallbackMedium: string;
  readonly summary: string;
}

/** Inbox row (dev face). */
export interface InboxRow {
  readonly id: string;
  readonly medium: string;
  readonly toMasked: string;
  readonly subject: string | null;
  readonly text: string | null;
  readonly html: string | null;
  readonly template: string | null;
  readonly locale: string | null;
  readonly at: number;
}

/** Receipt row. */
export interface ReceiptRow {
  readonly id: string;
  readonly template: string;
  readonly toMasked: string;
  readonly medium: string;
  readonly locale: string | null;
  readonly localeChain: readonly string[];
  readonly status: string;
  readonly chain: string;
  readonly messageId: string | null;
  readonly at: number;
  readonly error: string | null;
}

/** Suppression row. */
export interface SuppressionRow {
  readonly subjectMasked: string;
  readonly medium: string;
  readonly reason: "opted-out" | "prior-bounce";
  readonly at: number;
}

/** Full list response. */
export interface ChannelsListResponse {
  readonly face: ChannelsFace;
  readonly production: boolean;
  readonly templates: readonly ChannelTemplate[];
  readonly outcomes: readonly OutcomeRow[];
  readonly fallback: FallbackMetric;
  readonly inbox: readonly InboxRow[];
  readonly receipts: readonly ReceiptRow[];
  readonly suppression: readonly SuppressionRow[];
}

/** Template preview. */
export interface ChannelPreview {
  readonly template: string;
  readonly locale: string;
  readonly localeChain: readonly string[];
  readonly dir: "ltr" | "rtl";
  readonly subject: string | null;
  readonly text: string | null;
  readonly html: string | null;
}

/** Email auth strip. */
export interface EmailAuthView {
  readonly domain: string;
  readonly spf: "pass" | "fail" | "missing";
  readonly dkim: "pass" | "fail" | "missing";
  readonly dmarc: "pass" | "fail" | "missing";
  readonly checkedAt: number;
}
