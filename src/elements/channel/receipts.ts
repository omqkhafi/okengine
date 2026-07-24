/**
 * Delivery receipts — recorded for every send attempt / outcome.
 */

import type { ChannelAttempt } from "../../drivers/channel-types.ts";

/** Delivery receipt. */
export interface DeliveryReceipt {
  readonly id: string;
  readonly template: string;
  readonly to: string;
  readonly medium: string;
  readonly locale?: string;
  readonly status: "sent" | "failed" | "opted-out" | "fallback";
  readonly messageId?: string;
  readonly driverId?: string;
  readonly attempts: readonly ChannelAttempt[];
  readonly at: number;
  readonly error?: string;
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
  };
}
