/**
 * Default editor buffers + store pick for the SQL / KV query console.
 */

import type { StoreFacet, StoreListStore } from "@/client.ts";

/** Console auth schema — raw SQL is refused. */
export const CONSOLE_AUTH_STORE_REF = "sql:oke_console";

/**
 * Seed SQL for a table (or `SELECT 1` when none).
 *
 * @param table - Table name
 */
export function defaultSqlQuery(table?: string): string {
  if (!table) return "SELECT 1;";
  return `SELECT *\nFROM "${table}"\nLIMIT 50;`;
}

/**
 * Seed KV command for a namespace prefix.
 *
 * @param prefix - Optional `list` prefix (often `namespace:`)
 */
export function defaultKvQuery(prefix?: string): string {
  if (!prefix) {
    return "// list  ·  get  ·  set  ·  delete  ·  ttl\nlist";
  }
  return `// list  ·  get  ·  set  ·  delete  ·  ttl\nlist ${prefix}`;
}

/**
 * Pick the store a query console should run against.
 *
 * Prefers the selected resource's store when it matches `facet`, then the
 * first non-auth store of that facet, then any store of that facet.
 *
 * @param stores - Projected store rows
 * @param facet - SQL or KV
 * @param selectedEffectRef - Current tree selection
 */
export function pickQueryStore(
  stores: readonly StoreListStore[],
  facet: Extract<StoreFacet, "sql" | "kv">,
  selectedEffectRef: string | null,
): StoreListStore | null {
  const ofFacet = stores.filter((s) => s.facet === facet);
  if (ofFacet.length === 0) return null;

  if (selectedEffectRef) {
    const selected = ofFacet.find(
      (s) =>
        s.ref === selectedEffectRef || s.children.some((c) => c.effectRef === selectedEffectRef),
    );
    if (selected) return selected;
  }

  return ofFacet.find((s) => s.ref !== CONSOLE_AUTH_STORE_REF) ?? ofFacet[0] ?? null;
}

/**
 * Default child name under a store (first table / namespace).
 *
 * @param store - Store row
 */
export function firstChildName(store: StoreListStore): string | undefined {
  return store.children[0]?.name;
}

/**
 * Whether raw SQL / writes are refused for this store.
 *
 * @param ref - Store ref
 */
export function isConsoleAuthStore(ref: string): boolean {
  return ref === CONSOLE_AUTH_STORE_REF;
}
