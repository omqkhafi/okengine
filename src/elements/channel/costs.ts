/**
 * Channel medium unit costs — fallback rate as a weekly bill (console §9.9 · §9.12).
 */

import type { ChannelMedium } from "../../manifest/types.ts";
import type { DeliveryReceipt } from "./receipts.ts";

/** USD per message by medium. */
export type MediumCosts = Readonly<Partial<Record<ChannelMedium, number>>>;

/**
 * Default unit costs (USD / message). Overridable on the runtime.
 * Rough public-cloud ballparks — the unit that matters is the weekly delta.
 */
export const DEFAULT_MEDIUM_COSTS: MediumCosts = {
  email: 0.0001,
  sms: 0.0075,
  whatsapp: 0.005,
  push: 0.00005,
  any: 0.005,
};

/** Weekly fallback cost projection. */
export interface FallbackWeeklyCostDelta {
  /** Fraction of sends that used a fallback (0–1). */
  readonly fallbackRate: number;
  /** Count of fallback receipts in the window. */
  readonly fallbackCount: number;
  /** Total sends in the window. */
  readonly totalCount: number;
  /** Extra USD this week vs primary-medium-only. */
  readonly weeklyDeltaUsd: number;
  /** Primary (first attempted) medium for the sample. */
  readonly primaryMedium: string;
  /** Winning fallback medium (last success) when available. */
  readonly fallbackMedium: string;
}

/**
 * Cost of one medium.
 *
 * @param medium - Channel medium
 * @param costs - Unit cost table
 */
export function costOf(medium: string, costs: MediumCosts = DEFAULT_MEDIUM_COSTS): number {
  return costs[medium as ChannelMedium] ?? costs.any ?? 0.005;
}

/**
 * Project fallback rate into a weekly cost delta vs primary-medium-only.
 *
 * For each fallback receipt: delta = cost(winner) − cost(primary attempt).
 * Summed over the week window (not per-call — §9.12).
 *
 * @param receipts - Delivery receipts
 * @param options - Costs + week window
 */
export function fallbackWeeklyCostDelta(
  receipts: readonly DeliveryReceipt[],
  options: {
    readonly costs?: MediumCosts;
    readonly weekStartMs: number;
    readonly weekEndMs?: number;
    readonly now?: number;
  },
): FallbackWeeklyCostDelta {
  const costs = options.costs ?? DEFAULT_MEDIUM_COSTS;
  const end = options.weekEndMs ?? options.now ?? Date.now();
  const inWeek = receipts.filter((r) => r.at >= options.weekStartMs && r.at <= end);
  const fallbacks = inWeek.filter((r) => r.status === "fallback");

  let weeklyDeltaUsd = 0;
  let primaryMedium = "whatsapp";
  let fallbackMedium = "sms";

  for (const r of fallbacks) {
    const first = r.attempts[0];
    const winner = [...r.attempts].reverse().find((a) => a.ok) ?? r.attempts.at(-1);
    if (!first || !winner) continue;
    const primary = mediumFromDriver(first.driverId, r.medium);
    const fb = mediumFromDriver(winner.driverId, r.medium);
    primaryMedium = primary;
    fallbackMedium = fb;
    weeklyDeltaUsd += costOf(fb, costs) - costOf(primary, costs);
  }

  // If winner is cheaper, delta can be negative — still report it.
  const totalCount = inWeek.length;
  const fallbackCount = fallbacks.length;
  return {
    fallbackRate: totalCount === 0 ? 0 : fallbackCount / totalCount,
    fallbackCount,
    totalCount,
    weeklyDeltaUsd,
    primaryMedium,
    fallbackMedium,
  };
}

/**
 * Best-effort map of driver id → medium for cost accounting.
 *
 * @param driverId - Driver / provider id
 * @param receiptMedium - Receipt medium fallback
 */
function mediumFromDriver(driverId: string, receiptMedium: string): string {
  const id = driverId.toLowerCase();
  if (id.includes("wa") || id.includes("whatsapp")) return "whatsapp";
  if (
    id.includes("sms") ||
    id.includes("taqnyat") ||
    id.includes("msegat") ||
    id.includes("unifonic") ||
    id.includes("twilio")
  ) {
    return "sms";
  }
  if (id.includes("push") || id.includes("fcm") || id.includes("webpush")) {
    return "push";
  }
  if (
    id.includes("smtp") ||
    id.includes("resend") ||
    id.includes("sndr") ||
    id.includes("ses") ||
    id.includes("email")
  ) {
    return "email";
  }
  return receiptMedium === "any" ? "email" : receiptMedium;
}
