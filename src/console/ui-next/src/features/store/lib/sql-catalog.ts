/**
 * SQL catalog folders in the Store tree (indexes / functions / triggers /
 * extensions / RLS policies).
 */

import type { StoreListChild } from "@/client.ts";

/** Catalog kind on a SQL store child. */
export type SqlCatalogKind = "index" | "function" | "trigger" | "extension" | "policy";

/**
 * Catalog kind when the child is a catalog folder.
 *
 * @param child - Store-list child
 */
export function childCatalogKind(child: StoreListChild): SqlCatalogKind | null {
  if (
    child.kind === "index" ||
    child.kind === "function" ||
    child.kind === "trigger" ||
    child.kind === "extension" ||
    child.kind === "policy"
  ) {
    return child.kind;
  }
  return null;
}

/**
 * True when the child is Indexes / Functions / Extensions (not a table).
 *
 * @param child - Store-list child
 */
export function isSqlCatalogChild(child: StoreListChild): boolean {
  return childCatalogKind(child) !== null;
}

/**
 * True when the child is the Extensions catalog (enable / disable).
 *
 * @param child - Store-list child
 */
export function isSqlExtensionChild(child: StoreListChild): boolean {
  return childCatalogKind(child) === "extension";
}

/**
 * True when the child is the RLS Policies catalog.
 *
 * @param child - Store-list child
 */
export function isSqlPolicyChild(child: StoreListChild): boolean {
  return childCatalogKind(child) === "policy";
}

/**
 * Tree / header label for a child (`Indexes` instead of `indexes`).
 *
 * @param child - Store-list child
 */
export function storeChildLabel(child: StoreListChild): string {
  const kind = childCatalogKind(child);
  if (kind === "index") return "Indexes";
  if (kind === "function") return "Functions";
  if (kind === "trigger") return "Triggers";
  if (kind === "extension") return "Extensions";
  if (kind === "policy") return "RLS Policies";
  return child.name;
}

/**
 * Split SQL children into tables vs catalog folders.
 *
 * @param children - Store children
 */
export function groupSqlChildren(children: readonly StoreListChild[]): {
  readonly tables: readonly StoreListChild[];
  readonly catalog: readonly StoreListChild[];
} {
  const tables: StoreListChild[] = [];
  const catalog: StoreListChild[] = [];
  for (const child of children) {
    if (isSqlCatalogChild(child)) catalog.push(child);
    else tables.push(child);
  }
  return { tables, catalog };
}
