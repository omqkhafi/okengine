/**
 * Group / filter Manifest Diff rows — render-only, no reclassification.
 */

import type { DiffCategory, DiffCategoryGroup, DiffChangeRecord } from "./types.ts";

/** Display order — blast radius descending. */
export const DIFF_CATEGORY_ORDER: readonly DiffCategory[] = [
  "contract-breaking",
  "permission-widening",
  "effect-widening",
  "no-impact",
] as const;

/** Human labels for the four categories. */
export const DIFF_CATEGORY_LABELS: Readonly<Record<DiffCategory, string>> = {
  "contract-breaking": "Contract breaking",
  "permission-widening": "Permission widening",
  "effect-widening": "Effect widening",
  "no-impact": "No impact",
};

/**
 * Filter changes by free-text query and optional category facet.
 *
 * @param changes - Projection rows (already classified)
 * @param q - Free-text filter
 * @param category - Optional category facet
 */
export function filterChanges(
  changes: readonly DiffChangeRecord[],
  q: string,
  category?: DiffCategory,
): readonly DiffChangeRecord[] {
  const needle = q.trim().toLowerCase();
  return changes.filter((c) => {
    if (category && c.category !== category) return false;
    if (!needle) return true;
    return (
      c.path.toLowerCase().includes(needle) ||
      c.summary.toLowerCase().includes(needle) ||
      (c.blastLine?.toLowerCase().includes(needle) ?? false) ||
      (c.flowName?.toLowerCase().includes(needle) ?? false) ||
      (c.weeklyBillLine?.toLowerCase().includes(needle) ?? false)
    );
  });
}

/**
 * Group filtered changes into the four blast-radius sections.
 * Empty categories are omitted.
 *
 * @param changes - Filtered rows
 */
export function groupByCategory(
  changes: readonly DiffChangeRecord[],
): readonly DiffCategoryGroup[] {
  const buckets = new Map<DiffCategory, DiffChangeRecord[]>();
  for (const cat of DIFF_CATEGORY_ORDER) {
    buckets.set(cat, []);
  }
  for (const c of changes) {
    buckets.get(c.category)?.push(c);
  }
  return DIFF_CATEGORY_ORDER.flatMap((category) => {
    const items = buckets.get(category) ?? [];
    if (items.length === 0) return [];
    return [
      {
        category,
        label: DIFF_CATEGORY_LABELS[category],
        items,
      },
    ];
  });
}

/**
 * CI gate label for a contract-breaking row.
 *
 * @param ciGate - Gate status from the projection
 */
export function formatCiGate(ciGate: DiffChangeRecord["ciGate"]): string | null {
  if (ciGate === "blocked") {
    return "CI gate: blocked — undeclared break";
  }
  if (ciGate === "acknowledged") {
    return "CI gate: allowed — breaking: true";
  }
  return null;
}
