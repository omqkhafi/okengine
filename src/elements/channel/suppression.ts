/**
 * Suppression list — opted-out + prior hard bounce (console §9.9).
 *
 * Suppression is protective, not failure.
 */

import type { ChannelMedium } from "../../manifest/types.ts";
import { createConsentStore, type ConsentStore, type OptOut } from "./consent.ts";

/** Why an address is suppressed. */
export type SuppressionReason = "opted-out" | "prior-bounce";

/** One suppression entry. */
export interface SuppressionEntry {
  readonly subject: string;
  readonly medium: ChannelMedium | "all";
  readonly reason: SuppressionReason;
  readonly at: number;
}

/** Suppression store surface. */
export interface SuppressionStore {
  /** Underlying consent / opt-out store. */
  readonly consent: ConsentStore;
  /**
   * Whether the subject is suppressed for this medium.
   *
   * @param subject - Address / id
   * @param medium - Channel medium
   */
  isSuppressed(
    subject: string,
    medium: ChannelMedium,
  ):
    | { readonly suppressed: true; readonly reason: SuppressionReason }
    | {
        readonly suppressed: false;
      };
  /**
   * Record an opt-out.
   *
   * @param subject - Address / id
   * @param medium - Medium or `all`
   */
  optOut(subject: string, medium: ChannelMedium | "all"): void;
  /**
   * Add a prior hard-bounce suppression.
   *
   * @param subject - Address / id
   * @param medium - Medium or `all`
   */
  addPriorBounce(subject: string, medium: ChannelMedium | "all"): void;
  /**
   * Clear suppression (re-consent / remove bounce block).
   *
   * @param subject - Address / id
   * @param medium - Medium or `all`
   */
  clear(subject: string, medium: ChannelMedium | "all"): void;
  /** Snapshot of all suppressions. */
  list(): readonly SuppressionEntry[];
}

/**
 * Create an in-memory suppression store backed by consent + bounce set.
 *
 * @param options - Optional shared consent store
 */
export function createSuppressionStore(
  options: { readonly consent?: ConsentStore } = {},
): SuppressionStore {
  const consent = options.consent ?? createConsentStore();
  const bounces: OptOut[] = [];

  function bounceMatches(subject: string, medium: ChannelMedium): boolean {
    return bounces.some(
      (r) => r.subject === subject && (r.medium === "all" || r.medium === medium),
    );
  }

  return {
    consent,
    isSuppressed(subject, medium) {
      if (consent.isOptedOut(subject, medium)) {
        return { suppressed: true, reason: "opted-out" };
      }
      if (bounceMatches(subject, medium)) {
        return { suppressed: true, reason: "prior-bounce" };
      }
      return { suppressed: false };
    },
    optOut(subject, medium) {
      consent.optOut(subject, medium);
    },
    addPriorBounce(subject, medium) {
      if (!bounces.some((r) => r.subject === subject && r.medium === medium)) {
        bounces.push({ subject, medium, at: Date.now() });
      }
    },
    clear(subject, medium) {
      consent.optIn(subject, medium);
      for (let i = bounces.length - 1; i >= 0; i--) {
        const r = bounces[i]!;
        if (r.subject === subject && r.medium === medium) {
          bounces.splice(i, 1);
        }
      }
    },
    list() {
      const rows: SuppressionEntry[] = [];
      for (const o of consent.list()) {
        rows.push({
          subject: o.subject,
          medium: o.medium,
          reason: "opted-out",
          at: o.at,
        });
      }
      for (const b of bounces) {
        rows.push({
          subject: b.subject,
          medium: b.medium,
          reason: "prior-bounce",
          at: b.at,
        });
      }
      return rows.sort((a, b) => b.at - a.at);
    },
  };
}
