/**
 * Store explorer tree — facet bands → store → children.
 */

import { DatabaseIcon, File01Icon, Key01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import type { StoreFacet, StoreListChild, StoreListStore } from "@/client.ts";
import type { ElementHugeIcon } from "@/lib/element-icons.ts";
import { isStoreFacet, STORE_FACETS } from "./parse-resource-ref.ts";

export { STORE_FACETS };
import { isSqlCatalogChild, storeChildLabel } from "./sql-catalog.ts";

/** Facet band label for the left explorer. */
export const STORE_FACET_LABELS: Record<StoreFacet, string> = {
  sql: "SQL",
  kv: "KV",
  files: "Files",
  index: "Index",
};

/**
 * Icon + tinted well per Store facet (Units-tree parity).
 *
 * Distinct glyphs so SQL / KV / Files / Index scan apart at a glance.
 */
export const STORE_FACET_SPECS: Record<
  StoreFacet,
  {
    readonly icon: ElementHugeIcon;
    readonly label: string;
    /** Border / fill / text classes for a size-5 icon well. */
    readonly wellClass: string;
  }
> = {
  sql: {
    icon: DatabaseIcon,
    label: STORE_FACET_LABELS.sql,
    wellClass: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  kv: {
    icon: Key01Icon,
    label: STORE_FACET_LABELS.kv,
    wellClass: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  files: {
    icon: File01Icon,
    label: STORE_FACET_LABELS.files,
    wellClass: "border-sky-500/35 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  index: {
    icon: Search01Icon,
    label: STORE_FACET_LABELS.index,
    wellClass: "border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
};

/** One store node with its children (after filter). */
export type StoreTreeStore = {
  readonly store: StoreListStore;
  readonly children: readonly StoreListChild[];
};

/** Facet band in the explorer. */
export type StoreFacetBand = {
  readonly facet: StoreFacet;
  readonly label: string;
  readonly stores: readonly StoreTreeStore[];
};

/** Resolved selection for query / detail. */
export type StoreSelection = {
  readonly store: StoreListStore;
  readonly child: StoreListChild;
};

/**
 * Group stores into facet bands (empty bands omitted).
 *
 * @param stores - Projected store rows
 */
export function bandStoreTree(stores: readonly StoreListStore[]): StoreFacetBand[] {
  return STORE_FACETS.map((facet) => ({
    facet,
    label: STORE_FACET_LABELS[facet],
    stores: stores
      .filter((s) => s.facet === facet)
      .map((store) => ({ store, children: store.children })),
  })).filter((b) => b.stores.length > 0);
}

/**
 * Filter stores / children by name, ref, or effectRef substring.
 *
 * @param stores - Projected store rows
 * @param query - Free-text filter
 */
export function filterStoreTree(
  stores: readonly StoreListStore[],
  query: string,
): StoreListStore[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...stores];

  const out: StoreListStore[] = [];
  for (const store of stores) {
    const storeHit =
      store.name.toLowerCase().includes(needle) ||
      store.ref.toLowerCase().includes(needle) ||
      (store.description?.toLowerCase().includes(needle) ?? false);
    const children = store.children.filter(
      (c) =>
        storeHit ||
        c.name.toLowerCase().includes(needle) ||
        storeChildLabel(c).toLowerCase().includes(needle) ||
        c.effectRef.toLowerCase().includes(needle),
    );
    if (storeHit || children.length > 0) {
      out.push({
        ...store,
        children: storeHit ? store.children : children,
      });
    }
  }
  return out;
}

/**
 * Find store + child by child.effectRef (URL selection identity).
 *
 * @param stores - Projected store rows
 * @param effectRef - e.g. `sql:bookings`
 */
export function findByEffectRef(
  stores: readonly StoreListStore[],
  effectRef: string,
): StoreSelection | null {
  for (const store of stores) {
    for (const child of store.children) {
      if (child.effectRef === effectRef) return { store, child };
    }
  }
  return null;
}

/**
 * True when the store is one child that shares the store name.
 * The tree shows a single leaf — not `comments` → `comments`.
 * SQL stays grouped (tables + catalog).
 *
 * @param store - Projected store row
 */
export function isSingletonStoreLeaf(store: StoreListStore): boolean {
  if (store.facet === "sql") return false;
  const only = store.children[0];
  return store.children.length === 1 && only !== undefined && only.name === store.name;
}

/**
 * Open-state key for a facet band in {@link StoreTree}.
 *
 * @param facet - Band facet
 */
export function storeTreeFacetKey(facet: StoreFacet): string {
  return `facet:${facet}`;
}

/**
 * Open-state key for the Tables folder under a SQL store.
 *
 * @param storeRef - Store ref
 */
export function storeTreeTablesKey(storeRef: string): string {
  return `${storeRef}/tables`;
}

/**
 * Whether a tree node is open. Facet bands default open; store and Tables folders default closed.
 *
 * @param key - {@link storeTreeFacetKey} or a store ref
 * @param openByKey - Explicit overrides
 */
export function storeTreeIsOpen(
  key: string,
  openByKey: Readonly<Record<string, boolean>>,
): boolean {
  const stored = openByKey[key];
  if (stored !== undefined) return stored;
  return key.startsWith("facet:");
}

/**
 * Keys for every collapsible node in the filtered tree (bands, then stores).
 *
 * @param bands - Visible facet bands
 */
export function storeTreeOpenKeys(bands: readonly StoreFacetBand[]): string[] {
  const keys: string[] = [];
  for (const band of bands) {
    keys.push(storeTreeFacetKey(band.facet));
    for (const node of band.stores) {
      if (isSingletonStoreLeaf(node.store)) continue;
      keys.push(node.store.ref);
      if (node.store.facet === "sql") keys.push(storeTreeTablesKey(node.store.ref));
    }
  }
  return keys;
}

/**
 * Keys that must be open to reveal a selected child.
 *
 * @param stores - Projected store rows
 * @param effectRef - Selected child effectRef
 */
export function storeTreeAncestorKeys(
  stores: readonly StoreListStore[],
  effectRef: string,
): string[] {
  const found = findByEffectRef(stores, effectRef);
  if (!found) return [];
  const keys = [storeTreeFacetKey(found.store.facet)];
  if (isSingletonStoreLeaf(found.store)) return keys;
  keys.push(found.store.ref);
  if (found.store.facet === "sql" && !isSqlCatalogChild(found.child)) {
    keys.push(storeTreeTablesKey(found.store.ref));
  }
  return keys;
}

/**
 * First selectable child effectRef in facet order (for default selection).
 *
 * @param stores - Projected store rows
 */
export function firstEffectRef(stores: readonly StoreListStore[]): string | null {
  for (const facet of STORE_FACETS) {
    for (const store of stores) {
      if (store.facet !== facet) continue;
      const child = store.children.find((c) => !isSqlCatalogChild(c));
      if (child) return child.effectRef;
    }
  }
  return null;
}

/** localStorage key for hidden Store explorer facet bands. */
export const HIDDEN_FACETS_KEY = "oke_store_hidden_facets";

/**
 * Parse a stored hidden-facet list. Unknown values are dropped.
 *
 * @param value - JSON from localStorage
 */
export function parseHiddenFacets(value: unknown): ReadonlySet<StoreFacet> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value.filter((item): item is StoreFacet => typeof item === "string" && isStoreFacet(item)),
  );
}

/**
 * Load hidden facet bands from localStorage.
 */
export function loadHiddenFacets(): ReadonlySet<StoreFacet> {
  try {
    if (typeof localStorage === "undefined") return new Set();
    const raw = localStorage.getItem(HIDDEN_FACETS_KEY);
    if (!raw) return new Set();
    return parseHiddenFacets(JSON.parse(raw) as unknown);
  } catch {
    return new Set();
  }
}

/**
 * Persist hidden facet bands.
 *
 * @param hidden - Facets tucked away in the explorer
 */
export function saveHiddenFacets(hidden: ReadonlySet<StoreFacet>): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(HIDDEN_FACETS_KEY, JSON.stringify([...hidden]));
  } catch {
    // quota / private mode
  }
}

/**
 * Add or remove a facet from the hidden set.
 *
 * @param hidden - Current hidden facets
 * @param facet - Band to toggle
 */
export function toggleHiddenFacet(
  hidden: ReadonlySet<StoreFacet>,
  facet: StoreFacet,
): ReadonlySet<StoreFacet> {
  const next = new Set(hidden);
  if (next.has(facet)) next.delete(facet);
  else next.add(facet);
  return next;
}

/**
 * Bands still listed in the explorer (hidden facets are omitted).
 *
 * @param bands - All facet bands after search
 * @param hidden - Facets the operator tucked away
 */
export function visibleFacetBands(
  bands: readonly StoreFacetBand[],
  hidden: ReadonlySet<StoreFacet>,
): StoreFacetBand[] {
  return bands.filter((band) => !hidden.has(band.facet));
}
