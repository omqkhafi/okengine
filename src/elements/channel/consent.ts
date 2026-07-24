/**
 * Consent / opt-out — Channel will not send without consent.
 */

import type { ChannelMedium } from "../../manifest/types.ts";

/** Opt-out record. */
export interface OptOut {
  readonly subject: string;
  readonly medium: ChannelMedium | "all";
  readonly at: number;
}

/** Consent store surface. */
export interface ConsentStore {
  /**
   * Whether the subject has opted out of this medium.
   *
   * @param subject - User / address id
   * @param medium - Channel medium
   */
  isOptedOut(subject: string, medium: ChannelMedium): boolean;
  /**
   * Record an opt-out.
   *
   * @param subject - User / address id
   * @param medium - Medium or `all`
   */
  optOut(subject: string, medium: ChannelMedium | "all"): void;
  /**
   * Clear an opt-out (re-consent).
   *
   * @param subject - User / address id
   * @param medium - Medium or `all`
   */
  optIn(subject: string, medium: ChannelMedium | "all"): void;
  /** Snapshot of all opt-outs. */
  list(): readonly OptOut[];
}

/**
 * Create an in-memory consent store.
 */
export function createConsentStore(): ConsentStore {
  const rows: OptOut[] = [];

  function matches(
    subject: string,
    medium: ChannelMedium,
  ): boolean {
    return rows.some(
      (r) =>
        r.subject === subject &&
        (r.medium === "all" || r.medium === medium),
    );
  }

  return {
    isOptedOut(subject, medium) {
      return matches(subject, medium);
    },
    optOut(subject, medium) {
      if (
        !rows.some((r) => r.subject === subject && r.medium === medium)
      ) {
        rows.push({ subject, medium, at: Date.now() });
      }
    },
    optIn(subject, medium) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i]!;
        if (r.subject === subject && r.medium === medium) {
          rows.splice(i, 1);
        }
      }
    },
    list() {
      return [...rows];
    },
  };
}
