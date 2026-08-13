/**
 * Parse Manifest / effect resource refs (`sql:bookings`, `kv:sessions`).
 */

/** Store facet vocabulary. */
export const STORE_FACETS = ["sql", "kv", "files", "index"] as const;

/** One of the four Store facets. */
export type StoreFacet = (typeof STORE_FACETS)[number];

/** Parsed effect / store resource ref. */
export type ParsedResourceRef = {
  readonly facet: StoreFacet;
  readonly name: string;
};

/**
 * Parse `facet:name` into parts. Returns null when the facet is unknown or name empty.
 *
 * @param ref - Effect or store ref string
 */
export function parseResourceRef(ref: string): ParsedResourceRef | null {
  const colon = ref.indexOf(":");
  if (colon <= 0) return null;
  const facet = ref.slice(0, colon);
  const name = ref.slice(colon + 1);
  if (!isStoreFacet(facet) || name.length === 0) return null;
  return { facet, name };
}

/**
 * Type guard for store facets.
 *
 * @param value - Candidate facet string
 */
export function isStoreFacet(value: string): value is StoreFacet {
  return (STORE_FACETS as readonly string[]).includes(value);
}
