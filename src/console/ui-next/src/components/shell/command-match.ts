/**
 * Fuzzy subsequence match for the Console command palette.
 */

/**
 * True when every character of `needle` appears in order inside `hay`.
 *
 * @param needle - Query
 * @param hay - Label, group, or keyword
 */
export function fuzzyMatch(needle: string, hay: string): boolean {
  if (needle.length === 0) return true;
  const query = needle.toLowerCase();
  const text = hay.toLowerCase();
  let i = 0;
  for (const ch of text) {
    if (ch === query[i]) i += 1;
    if (i === query.length) return true;
  }
  return false;
}

/** Searchable command fields used by {@link filterCommandItems}. */
export type CommandSearchable = {
  readonly label: string;
  readonly group?: string;
  readonly keywords?: readonly string[];
};

/**
 * Keep items whose label, group, or keywords fuzzy-match `query`.
 *
 * @param items - Command list
 * @param query - Filter text
 */
export function filterCommandItems<T extends CommandSearchable>(
  items: readonly T[],
  query: string,
): readonly T[] {
  if (query.length === 0) return items;
  return items.filter((item) => {
    const haystacks = [item.label, item.group ?? "", ...(item.keywords ?? [])];
    return haystacks.some((hay) => fuzzyMatch(query, hay));
  });
}
