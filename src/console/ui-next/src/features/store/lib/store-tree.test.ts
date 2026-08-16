/**
 * Unit tests for Store tree, fields-from-table, and parse-resource-ref.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../../../../../manifest/types.ts";
import type { StoreListStore } from "@/client.ts";
import { fieldsFromTable } from "./fields-from-table.ts";
import { parseResourceRef } from "./parse-resource-ref.ts";
import {
  bandStoreTree,
  filterStoreTree,
  findByEffectRef,
  firstEffectRef,
  parseHiddenFacets,
  storeTreeAncestorKeys,
  storeTreeFacetKey,
  storeTreeIsOpen,
  storeTreeOpenKeys,
  isSingletonStoreLeaf,
  storeTreeTablesKey,
  toggleHiddenFacet,
  visibleFacetBands,
} from "./store-tree.ts";

const emptyWillNot = {
  writerFlowIds: [] as string[],
  signals: [] as string[],
  channels: [] as string[],
};

const emptyCache = {
  producedByRead: "cache:sql:bookings",
  invalidatedByWrites: [] as string[],
  invalidatingFlowIds: [] as string[],
};

function child(
  name: string,
  effectRef: string,
  extras?: Partial<StoreListStore["children"][number]>,
): StoreListStore["children"][number] {
  return {
    name,
    effectRef,
    writers: [],
    readers: [],
    cache: emptyCache,
    willNotFire: emptyWillNot,
    piiColumns: [],
    columnDescriptions: {},
    ...extras,
  };
}

const STORES: readonly StoreListStore[] = [
  {
    ref: "sql:db",
    facet: "sql",
    name: "db",
    description: "Primary",
    children: [
      child("bookings", "sql:bookings"),
      child("shipments", "sql:shipments"),
      child("indexes", "sql:db/indexes", { kind: "index" }),
      child("functions", "sql:db/functions", { kind: "function" }),
      child("triggers", "sql:db/triggers", { kind: "trigger" }),
      child("extensions", "sql:db/extensions", { kind: "extension" }),
      child("policies", "sql:db/policies", { kind: "policy" }),
    ],
    replicaLagMs: null,
    migrationDrift: null,
    contentAddressed: false,
    warnings: [],
  },
  {
    ref: "kv:cache",
    facet: "kv",
    name: "cache",
    children: [child("holds", "kv:cache")],
    replicaLagMs: null,
    migrationDrift: null,
    contentAddressed: false,
    warnings: [],
  },
  {
    ref: "index:comments",
    facet: "index",
    name: "comments",
    children: [child("comments", "index:comments")],
    replicaLagMs: null,
    migrationDrift: null,
    contentAddressed: false,
    warnings: [],
  },
];

describe("parseResourceRef", () => {
  test("parses facet:name", () => {
    expect(parseResourceRef("sql:bookings")).toEqual({ facet: "sql", name: "bookings" });
    expect(parseResourceRef("kv:sessions")).toEqual({ facet: "kv", name: "sessions" });
  });

  test("rejects unknown facet or empty name", () => {
    expect(parseResourceRef("blob:x")).toBeNull();
    expect(parseResourceRef("sql:")).toBeNull();
    expect(parseResourceRef("bookings")).toBeNull();
  });
});

describe("store-tree", () => {
  test("bands by facet and finds by effectRef", () => {
    const bands = bandStoreTree(STORES);
    expect(bands.map((b) => b.facet)).toEqual(["sql", "kv", "index"]);
    expect(findByEffectRef(STORES, "sql:shipments")?.child.name).toBe("shipments");
    expect(findByEffectRef(STORES, "sql:shipments")?.store.ref).toBe("sql:db");
    expect(firstEffectRef(STORES)).toBe("sql:bookings");
  });

  test("filters by child name without dropping sibling stores incorrectly", () => {
    const filtered = filterStoreTree(STORES, "ship");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.children.map((c) => c.name)).toEqual(["shipments"]);
  });

  test("open keys cover each band, store folder, and SQL Tables folder", () => {
    const bands = bandStoreTree(STORES);
    expect(storeTreeFacetKey("sql")).toBe("facet:sql");
    expect(storeTreeOpenKeys(bands)).toEqual([
      "facet:sql",
      "sql:db",
      storeTreeTablesKey("sql:db"),
      "facet:kv",
      "kv:cache",
      "facet:index",
    ]);
  });

  test("singleton index / kv / files skip the folder wrap", () => {
    expect(isSingletonStoreLeaf(STORES[2]!)).toBe(true);
    expect(isSingletonStoreLeaf(STORES[1]!)).toBe(false);
    expect(isSingletonStoreLeaf(STORES[0]!)).toBe(false);
    expect(storeTreeAncestorKeys(STORES, "index:comments")).toEqual(["facet:index"]);
  });

  test("ancestor keys open the facet, store, and Tables folder for a table", () => {
    expect(storeTreeAncestorKeys(STORES, "sql:shipments")).toEqual([
      "facet:sql",
      "sql:db",
      "sql:db/tables",
    ]);
    expect(storeTreeAncestorKeys(STORES, "sql:db/indexes")).toEqual(["facet:sql", "sql:db"]);
    expect(storeTreeAncestorKeys(STORES, "missing")).toEqual([]);
  });

  test("firstEffectRef skips catalog folders", () => {
    expect(firstEffectRef(STORES)).toBe("sql:bookings");
  });

  test("filters catalog folders by display label", () => {
    const filtered = filterStoreTree(STORES, "indexes");
    expect(filtered[0]?.children.map((c) => c.name)).toEqual(["indexes"]);
    expect(filterStoreTree(STORES, "rls")[0]?.children.map((c) => c.name)).toEqual(["policies"]);
  });

  test("facet bands default open and store folders default closed", () => {
    expect(storeTreeIsOpen("facet:sql", {})).toBe(true);
    expect(storeTreeIsOpen("sql:db", {})).toBe(false);
    expect(storeTreeIsOpen("sql:db/tables", {})).toBe(false);
    expect(storeTreeIsOpen("sql:db", { "sql:db": true })).toBe(true);
    expect(storeTreeIsOpen("facet:sql", { "facet:sql": false })).toBe(false);
  });

  test("hidden facet parse drops unknown values and toggle is reversible", () => {
    expect([...parseHiddenFacets(["kv", "nope", "files"])]).toEqual(["kv", "files"]);
    expect(parseHiddenFacets("kv").size).toBe(0);
    const hidden = toggleHiddenFacet(new Set(), "sql");
    expect(hidden.has("sql")).toBe(true);
    expect(toggleHiddenFacet(hidden, "sql").has("sql")).toBe(false);
  });

  test("visibleFacetBands omits hidden facets from expand-all keys", () => {
    const bands = bandStoreTree(STORES);
    const visible = visibleFacetBands(bands, new Set(["sql"]));
    expect(visible.map((b) => b.facet)).toEqual(["kv", "index"]);
    expect(storeTreeOpenKeys(visible)).toEqual(["facet:kv", "kv:cache", "facet:index"]);
  });
});

describe("fieldsFromTable", () => {
  const manifest = {
    stores: {
      db: {
        facet: "sql" as const,
        tables: {
          bookings: {
            columns: {
              id: { type: "text" as const, primaryKey: true },
              email: { type: "text" as const, pii: true },
              seats: { type: "integer" as const, nullable: true },
            },
          },
        },
      },
    },
  } as unknown as Manifest;

  test("maps DeclaredColumn tags into FormField pills", () => {
    const fields = fieldsFromTable(manifest, "db", "bookings");
    expect(fields.map((f) => f.name)).toEqual(["id", "email", "seats"]);
    expect(fields[0]).toMatchObject({ primaryKey: true, type: "string", required: true });
    expect(fields[1]).toMatchObject({ pii: true, type: "string" });
    expect(fields[2]).toMatchObject({ type: "integer", required: false });
  });

  test("returns empty when table missing", () => {
    expect(fieldsFromTable(manifest, "db", "missing")).toEqual([]);
    expect(fieldsFromTable(null, "db", "bookings")).toEqual([]);
  });
});
