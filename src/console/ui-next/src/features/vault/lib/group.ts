/**
 * Group vault contracts — secrets vs non-sensitive config (console §9.8).
 */

import { matchesVaultSearch, parseVaultSearch } from "./search.ts";
import type { VaultKindGroup, VaultRecord } from "./types.ts";

/**
 * Group secrets and config after applying deep search.
 *
 * @param secrets - Vault rows
 * @param query - Deep search string
 * @param now - Clock (epoch ms)
 */
export function groupByKind(
  secrets: readonly VaultRecord[],
  query = "",
  now = Date.now(),
): readonly VaultKindGroup[] {
  const parsed = parseVaultSearch(query);
  const filtered = secrets.filter((s) => matchesVaultSearch(s, parsed, now));

  const order: Array<"secret" | "config"> = ["secret", "config"];
  const labels = { secret: "Secrets", config: "Config" } as const;
  return order
    .map((kind) => ({
      kind,
      label: labels[kind],
      secrets: filtered.filter((s) => s.kind === kind),
    }))
    .filter((g) => g.secrets.length > 0);
}

/**
 * Deep-search match helper (name, description, operators, fingerprints, readers).
 *
 * @param secret - Row
 * @param query - Filter
 * @param now - Clock
 */
export function matchesQuery(secret: VaultRecord, query: string, now = Date.now()): boolean {
  return matchesVaultSearch(secret, parseVaultSearch(query), now);
}
