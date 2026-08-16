import { describe, expect, test } from "bun:test";
import { validateStoreSearch } from "./store-selection.ts";

describe("validateStoreSearch", () => {
  test("keeps resource and tenant", () => {
    expect(validateStoreSearch({ resource: "sql:bookings", tenant: "acme" })).toEqual({
      resource: "sql:bookings",
      tenant: "acme",
    });
  });

  test("accepts the query console view", () => {
    expect(validateStoreSearch({ view: "query", facet: "sql" })).toEqual({
      view: "query",
      facet: "sql",
    });
    expect(validateStoreSearch({ view: "query", facet: "kv" })).toEqual({
      view: "query",
      facet: "kv",
    });
  });

  test("accepts the schema visualizer view", () => {
    expect(validateStoreSearch({ view: "schema" })).toEqual({ view: "schema" });
  });

  test("accepts the query performance view", () => {
    expect(validateStoreSearch({ view: "performance" })).toEqual({ view: "performance" });
    expect(validateStoreSearch({ view: "performance", facet: "kv" })).toEqual({
      view: "performance",
      facet: "kv",
    });
  });

  test("drops unknown view / facet", () => {
    expect(validateStoreSearch({ view: "browse", facet: "files" })).toEqual({});
  });
});
