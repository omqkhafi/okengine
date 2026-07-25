/**
 * Group stores by facet — one list, adaptive detail (console §9.5).
 */

import type { StoreFacet, StoreFacetGroup, StoreRecord } from "./types.ts";

const FACET_ORDER: readonly StoreFacet[] = ["sql", "kv", "files", "index"];

const FACET_LABELS: Record<StoreFacet, string> = {
  sql: "SQL",
  kv: "KV",
  files: "Files",
  index: "Index",
};

/**
 * Group store rows by facet, optional name filter.
 *
 * @param stores - Projected rows
 * @param q - Optional filter
 */
export function groupByFacet(
  stores: readonly StoreRecord[],
  q = "",
): readonly StoreFacetGroup[] {
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? stores.filter(
        (s) =>
          s.name.toLowerCase().includes(needle) ||
          s.ref.toLowerCase().includes(needle) ||
          s.children.some((c) => c.name.toLowerCase().includes(needle)),
      )
    : stores;

  return FACET_ORDER.map((facet) => ({
    facet,
    label: FACET_LABELS[facet],
    stores: filtered.filter((s) => s.facet === facet),
  })).filter((g) => g.stores.length > 0);
}
