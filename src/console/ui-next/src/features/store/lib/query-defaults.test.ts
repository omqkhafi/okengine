import { describe, expect, test } from "bun:test";
import type { StoreListStore } from "@/client.ts";
import {
  CONSOLE_AUTH_STORE_REF,
  defaultKvQuery,
  defaultSqlQuery,
  isConsoleAuthStore,
  pickQueryStore,
} from "./query-defaults.ts";

const emptyWillNot = { writerFlowIds: [], signals: [], channels: [] };
const emptyCache = {
  producedByRead: "cache:sql:bookings",
  invalidatedByWrites: [] as string[],
  invalidatingFlowIds: [] as string[],
};

function store(ref: string, facet: "sql" | "kv", children: readonly string[]): StoreListStore {
  return {
    ref,
    facet,
    name: ref.slice(ref.indexOf(":") + 1),
    children: children.map((name) => ({
      name,
      effectRef: `${facet}:${name}`,
      writers: [],
      readers: [],
      cache: emptyCache,
      willNotFire: emptyWillNot,
      piiColumns: [],
      columnDescriptions: {},
    })),
    replicaLagMs: null,
    migrationDrift: null,
    contentAddressed: false,
    warnings: [],
  };
}

const STORES = [
  store(CONSOLE_AUTH_STORE_REF, "sql", ["oke_operators"]),
  store("sql:db", "sql", ["bookings", "shipments"]),
  store("kv:cache", "kv", ["holds"]),
];

describe("default queries", () => {
  test("sql seeds a limited select", () => {
    expect(defaultSqlQuery("bookings")).toContain('FROM "bookings"');
    expect(defaultSqlQuery()).toBe("SELECT 1;");
  });

  test("kv seeds list with a comment legend", () => {
    expect(defaultKvQuery("holds:")).toContain("list holds:");
    expect(defaultKvQuery()).toContain("list");
  });
});

describe("pickQueryStore", () => {
  test("prefers the selected resource store", () => {
    expect(pickQueryStore(STORES, "sql", "sql:shipments")?.ref).toBe("sql:db");
    expect(pickQueryStore(STORES, "kv", "kv:holds")?.ref).toBe("kv:cache");
  });

  test("skips oke_console when nothing is selected", () => {
    expect(pickQueryStore(STORES, "sql", null)?.ref).toBe("sql:db");
  });

  test("falls back to auth store when it is the only SQL store", () => {
    expect(pickQueryStore([STORES[0]!], "sql", null)?.ref).toBe(CONSOLE_AUTH_STORE_REF);
  });
});

describe("isConsoleAuthStore", () => {
  test("matches the operator-plane auth ref", () => {
    expect(isConsoleAuthStore(CONSOLE_AUTH_STORE_REF)).toBe(true);
    expect(isConsoleAuthStore("sql:db")).toBe(false);
  });
});
