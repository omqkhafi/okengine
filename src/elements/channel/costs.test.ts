/**
 * Fallback weekly cost delta (console §9.9 · §9.12).
 */

import { describe, expect, test } from "bun:test";
import { fallbackWeeklyCostDelta } from "./costs.ts";
import type { DeliveryReceipt } from "./receipts.ts";

describe("fallbackWeeklyCostDelta", () => {
  test("projects fallback rate into a weekly USD delta", () => {
    const weekStart = Date.UTC(2026, 6, 20);
    const receipts: DeliveryReceipt[] = [
      {
        id: "1",
        template: "otp-code",
        to: "a",
        medium: "any",
        status: "fallback",
        attempts: [
          { driverId: "wa-cloud", ok: false, at: weekStart + 1 },
          { driverId: "taqnyat", ok: true, at: weekStart + 2 },
        ],
        at: weekStart + 3,
      },
      {
        id: "2",
        template: "otp-code",
        to: "b",
        medium: "whatsapp",
        status: "sent",
        attempts: [{ driverId: "wa-cloud", ok: true, at: weekStart + 4 }],
        at: weekStart + 5,
      },
      {
        id: "3",
        template: "otp-code",
        to: "c",
        medium: "any",
        status: "fallback",
        attempts: [
          { driverId: "wa-cloud", ok: false, at: weekStart + 6 },
          { driverId: "msegat", ok: true, at: weekStart + 7 },
        ],
        at: weekStart + 8,
      },
    ];

    const delta = fallbackWeeklyCostDelta(receipts, {
      weekStartMs: weekStart,
      weekEndMs: weekStart + 86_400_000 * 7,
      costs: { whatsapp: 0.005, sms: 0.0075 },
    });

    expect(delta.totalCount).toBe(3);
    expect(delta.fallbackCount).toBe(2);
    expect(delta.fallbackRate).toBeCloseTo(2 / 3, 5);
    // Each fallback: sms 0.0075 − whatsapp 0.005 = 0.0025
    expect(delta.weeklyDeltaUsd).toBeCloseTo(0.005, 5);
    expect(delta.primaryMedium).toBe("whatsapp");
    expect(delta.fallbackMedium).toBe("sms");
  });
});
