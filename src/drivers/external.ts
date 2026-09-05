/**
 * Shared egress identity for driver call results and {@link EffectEntry.external}.
 *
 * Drivers report this on real call results — never inferred by hostname regex
 * at the ledger layer. Only `host` is required when present.
 */

/** Egress peer for an effect that left the process. */
export interface DriverExternal {
  /** Peer hostname (or equivalent) the call reached. */
  readonly host: string;
  /** Vendor / transport / registry label when known. */
  readonly provider?: string;
  /**
   * `"third-party"` — vendor business API.
   * `"infrastructure"` — developer-owned egress.
   */
  readonly kind?: "third-party" | "infrastructure";
}

/**
 * Hostname from an absolute URL or base URL string.
 *
 * @param url - Absolute URL
 */
export function hostFromUrl(url: string): string | undefined {
  try {
    const host = new URL(url).hostname;
    return host || undefined;
  } catch {
    return undefined;
  }
}
