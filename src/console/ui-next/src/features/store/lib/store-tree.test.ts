/**
 * Unit tests for Store tree, fields-from-table, and parse-resource-ref.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../../../../../manifest/types.ts";
import type { StoreListStore } from "@/client.ts";
import { fieldsFromTable } from "./fields-from-table.ts";
import { parseResourceRef } from "./parse-resource-ref.ts";
import { bandStoreTree, filterStoreTree, findByEffectRef, firstEffectRef } from "./store-tree.ts";

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
    children: [child("bookings", "sql:bookings"), child("shipments", "sql:shipments")],
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
    expect(bands.map((b) => b.facet)).toEqual(["sql", "kv"]);
    expect(findByEffectRef(STORES, "sql:shipments")?.child.name).toBe("shipments");
    expect(findByEffectRef(STORES, "sql:shipments")?.store.ref).toBe("sql:db");
    expect(firstEffectRef(STORES)).toBe("sql:bookings");
  });

  test("filters by child name without dropping sibling stores incorrectly", () => {
    const filtered = filterStoreTree(STORES, "ship");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.children.map((c) => c.name)).toEqual(["shipments"]);
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
