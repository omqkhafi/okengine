/**
 * Dormant (dead) secrets — last-read timestamps expose attack surface
 * that grows by forgetting (console §9.8 · §9.16).
 */

import type { VaultRecord } from "./types.ts";

/** Secrets unread for this long (or never) are dormant. */
export const DORMANT_MS = 90 * 86_400_000;

/**
 * Secrets with no recent read — never read, or idle ≥ 90 days.
 *
 * Config values are excluded; only secrets grow attack surface by neglect.
 *
 * @param secrets - Vault panel rows
 * @param now - Clock (epoch ms)
 */
export function dormantSecrets(
  secrets: readonly VaultRecord[],
  now: number,
): readonly VaultRecord[] {
  return secrets.filter((s) => {
    if (s.kind !== "secret") return false;
    if (s.lastReadAt == null) return true;
    return now - s.lastReadAt >= DORMANT_MS;
  });
}
