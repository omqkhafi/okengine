/**
 * URL search state for the Manifest Diff panel.
 */

import { z } from "zod";
import type { DiffCategory } from "./types.ts";

const DiffSearchSchema = z.object({
  /** Free-text filter over path / summary / blast line. */
  q: z.string().optional(),
  /** Focus a Manifest path (AI deep-link). */
  path: z.string().optional(),
  /** Optional category facet. */
  category: z
    .enum([
      "contract-breaking",
      "permission-widening",
      "effect-widening",
      "no-impact",
    ])
    .optional(),
});

/** Parsed Manifest Diff URL search. */
export type DiffSearch = z.infer<typeof DiffSearchSchema>;

/**
 * Parse Manifest Diff panel search params.
 *
 * @param search - Raw router search
 */
export function parseDiffSearch(
  search: Record<string, unknown>,
): DiffSearch {
  const parsed = DiffSearchSchema.safeParse(search);
  return parsed.success ? parsed.data : {};
}

/**
 * Serialize Diff search for navigation (omit empties).
 *
 * @param search - Search state
 */
export function serializeDiffSearch(
  search: DiffSearch,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (search.q) out.q = search.q;
  if (search.path) out.path = search.path;
  if (search.category) out.category = search.category;
  return out;
}

/**
 * Focus a change path in the URL.
 *
 * @param search - Current search
 * @param path - Manifest change path
 */
export function openDiffPath(search: DiffSearch, path: string): DiffSearch {
  return { ...search, path };
}

/**
 * Facet to one blast-radius category.
 *
 * @param search - Current search
 * @param category - Category or clear
 */
export function filterCategory(
  search: DiffSearch,
  category: DiffCategory | undefined,
): DiffSearch {
  return { ...search, category };
}
