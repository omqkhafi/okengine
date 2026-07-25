/**
 * Delivery receipts — recorded for every send attempt / outcome.
 */

import type { ChannelAttempt } from "../../drivers/channel-types.ts";
import type { DeliveryOutcomeState } from "./outcomes.ts";
import type { LocaleChainStep } from "./locale.ts";

/** Successful / in-flight send statuses. */
export type DeliverySuccessStatus = "sent" | "fallback";

/** Legacy alias kept for callers that still say "failed" / "opted-out". */
export type DeliveryLegacyStatus = "failed" | "opted-out";

/** Full receipt status — success paths + seven-state taxonomy. */
export type DeliveryStatus =
  | DeliverySuccessStatus
  | DeliveryLegacyStatus
  | DeliveryOutcomeState;

/** Delivery receipt. */
export interface DeliveryReceipt {
  readonly id: string;
  readonly template: string;
  readonly to: string;
  readonly medium: string;
  readonly locale?: string;
  readonly localeChain?: readonly LocaleChainStep[];
  readonly status: DeliveryStatus;
  readonly messageId?: string;
  readonly driverId?: string;
  readonly attempts: readonly ChannelAttempt[];
  readonly at: number;
  readonly error?: string;
}

/** Ingest a post-send provider outcome against an existing receipt. */
export interface IngestOutcomeInput {
  readonly messageId: string;
  readonly state: DeliveryOutcomeState;
  readonly at?: number;
  readonly error?: string;
  /** Recipient — used when creating a synthetic receipt if messageId is unknown. */
  readonly to?: string;
  readonly template?: string;
  readonly medium?: string;
}

/** Receipt ledger. */
export interface ReceiptLedger {
  /** Append a receipt. */
  record(receipt: DeliveryReceipt): void;
  /** All receipts. */
  all(): readonly DeliveryReceipt[];
  /**
   * Receipts for a template.
   *
   * @param template - Template name
   */
  forTemplate(template: string): readonly DeliveryReceipt[];
  /**
   * Find by provider message id.
   *
   * @param messageId - Provider / runtime message id
   */
  byMessageId(messageId: string): DeliveryReceipt | undefined;
  /**
   * Update an existing receipt's status (post-send bounce / complaint).
   *
   * @param messageId - Provider message id
   * @param patch - Status + optional error
   */
  updateStatus(
    messageId: string,
    patch: {
      readonly status: DeliveryStatus;
      readonly at?: number;
      readonly error?: string;
    },
  ): DeliveryReceipt | undefined;
}

/**
 * Create an in-memory receipt ledger.
 */
export function createReceiptLedger(): ReceiptLedger {
  const rows: DeliveryReceipt[] = [];
  return {
    record(receipt) {
      rows.push(receipt);
    },
    all() {
      return [...rows];
    },
    forTemplate(template) {
      return rows.filter((r) => r.template === template);
    },
    byMessageId(messageId) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i]!;
        if (r.messageId === messageId || r.id === messageId) return r;
      }
      return undefined;
    },
    updateStatus(messageId, patch) {
      const idx = rows.findIndex(
        (r) => r.messageId === messageId || r.id === messageId,
      );
      if (idx < 0) return undefined;
      const prev = rows[idx]!;
      const next: DeliveryReceipt = {
        ...prev,
        status: patch.status,
        at: patch.at ?? prev.at,
        ...(patch.error !== undefined ? { error: patch.error } : {}),
      };
      rows[idx] = next;
      return next;
    },
  };
}
