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

const DEFAULT_SQL = /^SELECT \*\nFROM "([^"]+)"\nLIMIT 50;$/;
const DEFAULT_KV = /^\/\/ list  ·  get  ·  set  ·  delete  ·  ttl\nlist(?: (.+))?$/;

/**
 * Replace a leftover default `SELECT` when that table is gone.
 * Custom SQL is left alone.
 *
 * @param text - Editor buffer
 * @param tables - Live table names
 * @param random - Unit interval used to pick a replacement table
 */
export function reconcileDefaultSql(
  text: string,
  tables: readonly string[],
  random: () => number = Math.random,
): string {
  const match = DEFAULT_SQL.exec(text);
  if (!match) return text;
  const table = match[1];
  if (table && tables.includes(table)) return text;
  return defaultSqlQuery(pickChildName(tables, random));
}

/**
 * Replace a leftover default `list ns:` when that namespace is gone.
 *
 * @param text - Editor buffer
 * @param namespaces - Live namespace names
 * @param random - Unit interval used to pick a replacement namespace
 */
export function reconcileDefaultKv(
  text: string,
  namespaces: readonly string[],
  random: () => number = Math.random,
): string {
  const match = DEFAULT_KV.exec(text);
  if (!match) return text;
  const prefix = match[1];
  if (!prefix) return text;
  const name = prefix.endsWith(":") ? prefix.slice(0, -1) : prefix;
  if (namespaces.includes(name)) return text;
  const next = pickChildName(namespaces, random);
  return defaultKvQuery(next ? `${next}:` : undefined);
}

/**
 * Re-seed a default buffer against the live store children.
 *
 * @param text - Editor buffer
 * @param names - Table or namespace names
 * @param facet - SQL or KV
 */
export function reconcileDefaultQuery(
  text: string,
  names: readonly string[],
  facet: Extract<StoreFacet, "sql" | "kv">,
): string {
  return facet === "sql" ? reconcileDefaultSql(text, names) : reconcileDefaultKv(text, names);
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
 * One live child name, picked at random.
 *
 * @param names - Table or namespace names
 * @param random - Unit interval in `[0, 1)`
 */
export function pickChildName(
  names: readonly string[],
  random: () => number = Math.random,
): string | undefined {
  if (names.length === 0) return undefined;
  const index = Math.min(names.length - 1, Math.floor(random() * names.length));
  return names[index];
}

/**
 * Default child name under a store (random table / namespace).
 *
 * @param store - Store row
 * @param random - Unit interval used to pick
 */
export function randomChildName(
  store: StoreListStore,
  random: () => number = Math.random,
): string | undefined {
  return pickChildName(
    store.children.map((child) => child.name),
    random,
  );
}

/**
 * Whether raw SQL / writes are refused for this store.
 *
 * @param ref - Store ref
 */
export function isConsoleAuthStore(ref: string): boolean {
  return ref === CONSOLE_AUTH_STORE_REF;
}
