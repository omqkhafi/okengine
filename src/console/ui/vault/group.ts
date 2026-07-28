/**
 * Group vault contracts — secrets vs non-sensitive config (console §9.8).
 */

import type { VaultKindGroup, VaultRecord } from "./types.ts";

/**
 * Group secrets and config; optional case-insensitive name/description filter.
 *
 * @param secrets - Vault rows
 * @param query - Optional filter
 */
export function groupByKind(
  secrets: readonly VaultRecord[],
  query = "",
): readonly VaultKindGroup[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? secrets.filter(
        (s) =>
          s.name.toLowerCase().includes(q) || (s.description?.toLowerCase().includes(q) ?? false),
      )
    : secrets;

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
 * Case-insensitive name match helper.
 *
 * @param secret - Row
 * @param query - Filter
 */
export function matchesQuery(secret: VaultRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    secret.name.toLowerCase().includes(q) ||
    (secret.description?.toLowerCase().includes(q) ?? false)
  );
}
