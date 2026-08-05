/**
 * Injection escape hatch adversarial proofs:
 * - custom suppression / receipts are used instead of process-local defaults
 * - consent-only injection is wrapped into suppression
 * - injecting both skips the process-local boot warn
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { ChannelMedium } from "../../manifest/types.ts";
import {
  channel,
  createChannelRuntime,
  createConsentStore,
  createReceiptLedger,
  createSuppressionStore,
  resetChannelProcessLocalWarnForTests,
  type DeliveryReceipt,
  type DeliveryStatus,
  type ReceiptLedger,
  type SuppressionStore,
} from "../channel.ts";
import { driverFromTransport, okTransport } from "./test-helpers.ts";

afterEach(() => {
  resetChannelProcessLocalWarnForTests();
});

function trackingReceipts(): ReceiptLedger & { records: number; updates: number } {
  const inner = createReceiptLedger();
  const ledger = {
    records: 0,
    updates: 0,
    record(receipt: DeliveryReceipt) {
      ledger.records += 1;
      inner.record(receipt);
    },
    all: () => inner.all(),
    forTemplate: (t: string) => inner.forTemplate(t),
    byMessageId: (id: string) => inner.byMessageId(id),
    updateStatus(
      messageId: string,
      patch: { status: DeliveryStatus; at?: number; error?: string },
    ) {
      ledger.updates += 1;
      return inner.updateStatus(messageId, patch);
    },
  };
  return ledger;
}

function trackingSuppression(): SuppressionStore & {
  checks: number;
  bounces: number;
} {
  const inner = createSuppressionStore();
  const store = {
    checks: 0,
    bounces: 0,
    get consent() {
      return inner.consent;
    },
    isSuppressed(subject: string, medium: ChannelMedium) {
      store.checks += 1;
      return inner.isSuppressed(subject, medium);
    },
    optOut(subject: string, medium: ChannelMedium | "all") {
      inner.optOut(subject, medium);
    },
    addPriorBounce(subject: string, medium: ChannelMedium | "all") {
      store.bounces += 1;
      inner.addPriorBounce(subject, medium);
    },
    clear(subject: string, medium: ChannelMedium | "all") {
      inner.clear(subject, medium);
    },
    list: () => inner.list(),
  };
  return store;
}

describe("channel store injection escape hatch", () => {
  test("injected suppression and receipts are genuinely used", async () => {
    const suppression = trackingSuppression();
    const receipts = trackingReceipts();
    const runtime = createChannelRuntime({
      templates: [channel.template("news", { medium: "email" })],
      drivers: [driverFromTransport("smtp", okTransport("smtp"))],
      suppression,
      receipts,
    });

    expect(runtime.suppression).toBe(suppression);
    expect(runtime.receipts).toBe(receipts);

    await runtime.send("news", { to: "a@b.c" });
    expect(suppression.checks).toBeGreaterThanOrEqual(1);
    expect(receipts.records).toBe(1);

    const mid = receipts.all()[0]!.messageId!;
    runtime.ingestOutcome({
      messageId: mid,
      state: "hard-bounce",
      to: "a@b.c",
      medium: "email",
    });
    expect(suppression.bounces).toBe(1);
    expect(receipts.updates).toBe(1);

    await runtime.send("news", { to: "a@b.c" });
    expect(receipts.all().at(-1)!.status).toBe("suppressed/prior-bounce");
    expect(receipts.records).toBe(2);
  });

  test("consent-only injection is consulted via wrapped suppression", async () => {
    const consent = createConsentStore();
    consent.optOut("x@y.z", "email");
    const receipts = trackingReceipts();
    const runtime = createChannelRuntime({
      templates: [channel.template("news", { medium: "email" })],
      drivers: [driverFromTransport("smtp", okTransport("smtp"))],
      consent,
      receipts,
    });

    const result = await runtime.send("news", { to: "x@y.z" });
    expect(result.ok).toBe(false);
    expect(receipts.records).toBe(1);
    expect(receipts.all()[0]!.status).toBe("suppressed/opted-out");
  });

  test("injecting both suppression and receipts skips process-local warn", () => {
    resetChannelProcessLocalWarnForTests();
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    };
    try {
      createChannelRuntime({
        suppression: createSuppressionStore(),
        receipts: createReceiptLedger(),
      });
      expect(warns.some((w) => w.includes("process-local memory"))).toBe(false);

      resetChannelProcessLocalWarnForTests();
      warns.length = 0;
      createChannelRuntime({});
      expect(warns.some((w) => w.includes("process-local memory"))).toBe(true);
    } finally {
      console.warn = original;
    }
  });
});
