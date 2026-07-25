/**
 * URL search state for the Store panel.
 */

import { z } from "zod";

const StoreSearchSchema = z.object({
  q: z.string().optional(),
  ref: z.string().optional(),
  child: z.string().optional(),
  /** Only meaningful when `tenancyDeclared` — compliance boundary, not a filter. */
  tenant: z.string().optional(),
  view: z.enum(["browse", "cache", "sql", "probe"]).optional(),
  prefix: z.string().optional(),
});

/** Parsed Store URL search. */
export type StoreSearch = z.infer<typeof StoreSearchSchema>;

/**
 * Parse Store panel search params.
 *
 * @param search - Raw router search
 */
export function parseStoreSearch(
  search: Record<string, unknown>,
): StoreSearch {
  const parsed = StoreSearchSchema.safeParse(search);
  return parsed.success ? parsed.data : {};
}

/**
 * Serialize Store search for navigation (omit empties).
 *
 * @param search - Search state
 */
export function serializeStoreSearch(
  search: StoreSearch,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (search.q) out.q = search.q;
  if (search.ref) out.ref = search.ref;
  if (search.child) out.child = search.child;
  if (search.tenant) out.tenant = search.tenant;
  if (search.view && search.view !== "browse") out.view = search.view;
  if (search.prefix) out.prefix = search.prefix;
  return out;
}

/**
 * Open a store ref in the URL.
 *
 * @param search - Current search
 * @param ref - Store ref
 */
export function openStore(search: StoreSearch, ref: string): StoreSearch {
  return { ...search, ref, child: undefined, view: "browse" };
}

/**
 * Close the open store detail.
 *
 * @param search - Current search
 */
export function closeStore(search: StoreSearch): StoreSearch {
  const { ref: _r, child: _c, view: _v, ...rest } = search;
  return rest;
}

/**
 * Select a child resource (table / keyspace / …).
 *
 * @param search - Current search
 * @param child - Child name
 */
export function openChild(search: StoreSearch, child: string): StoreSearch {
  return { ...search, child, view: "browse" };
}
