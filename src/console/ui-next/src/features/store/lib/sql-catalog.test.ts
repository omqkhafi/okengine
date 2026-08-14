import { describe, expect, test } from "bun:test";
import type { StoreListChild } from "@/client.ts";
import {
  groupSqlChildren,
  isSqlCatalogChild,
  isSqlExtensionChild,
  isSqlPolicyChild,
  storeChildLabel,
} from "./sql-catalog.ts";

const emptyWillNot = { writerFlowIds: [], signals: [], channels: [] };
const emptyCache = {
  producedByRead: "c",
  invalidatedByWrites: [] as string[],
  invalidatingFlowIds: [] as string[],
};

function child(name: string, kind?: StoreListChild["kind"]): StoreListChild {
  return {
    name,
    effectRef: `sql:${name}`,
    ...(kind ? { kind } : {}),
    writers: [],
    readers: [],
    cache: emptyCache,
    willNotFire: emptyWillNot,
    piiColumns: [],
    columnDescriptions: {},
  };
}

describe("sql catalog children", () => {
  test("labels reserved catalog folders", () => {
    expect(storeChildLabel(child("indexes", "index"))).toBe("Indexes");
    expect(storeChildLabel(child("triggers", "trigger"))).toBe("Triggers");
    expect(storeChildLabel(child("policies", "policy"))).toBe("RLS Policies");
    expect(storeChildLabel(child("bookings"))).toBe("bookings");
    expect(isSqlCatalogChild(child("functions", "function"))).toBe(true);
    expect(isSqlExtensionChild(child("extensions", "extension"))).toBe(true);
    expect(isSqlPolicyChild(child("policies", "policy"))).toBe(true);
  });

  test("splits tables from catalog folders", () => {
    const grouped = groupSqlChildren([
      child("bookings", "table"),
      child("indexes", "index"),
      child("functions", "function"),
    ]);
    expect(grouped.tables.map((c) => c.name)).toEqual(["bookings"]);
    expect(grouped.catalog.map((c) => c.kind)).toEqual(["index", "function"]);
  });
});
