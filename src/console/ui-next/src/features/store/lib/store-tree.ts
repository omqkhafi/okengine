/**
 * Store explorer tree — facet bands → store → children.
 */

import { Database01Icon, File01Icon, Key01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import type { StoreFacet, StoreListChild, StoreListStore } from "@/client.ts";
import type { ElementHugeIcon } from "@/lib/element-icons.ts";
import { STORE_FACETS } from "./parse-resource-ref.ts";

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
    icon: Database01Icon,
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
 * First selectable child effectRef in facet order (for default selection).
 *
 * @param stores - Projected store rows
 */
export function firstEffectRef(stores: readonly StoreListStore[]): string | null {
  for (const facet of STORE_FACETS) {
    for (const store of stores) {
      if (store.facet !== facet) continue;
      const child = store.children[0];
      if (child) return child.effectRef;
    }
  }
  return null;
}
