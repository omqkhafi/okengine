import { describe, expect, test } from "bun:test";
import { keepStoreQueryPage, STORE_QUERY_KEY } from "./use-store-query.ts";
import type { StoreQueryInput, StoreQueryResult } from "@/client.ts";

const PAGE: StoreQueryResult = { facet: "index", hits: [], masked: false };

function key(input: StoreQueryInput): readonly unknown[] {
  return [...STORE_QUERY_KEY, input];
}

describe("keepStoreQueryPage", () => {
  test("keeps the page when only q / topK / limit change", () => {
    const prev: StoreQueryInput = { ref: "index:search", child: "tasks", limit: 500 };
    const next: StoreQueryInput = {
      ref: "index:search",
      child: "tasks",
      limit: 500,
      q: "harbor",
      topK: 5,
    };
    expect(keepStoreQueryPage(PAGE, key(prev), next)).toBe(PAGE);
  });

  test("drops the page when the resource identity changes", () => {
    const prev: StoreQueryInput = { ref: "index:search", child: "tasks" };
    expect(
      keepStoreQueryPage(PAGE, key(prev), { ref: "index:search", child: "docs" }),
    ).toBeUndefined();
    expect(
      keepStoreQueryPage(PAGE, key(prev), { ref: "index:other", child: "tasks" }),
    ).toBeUndefined();
    expect(
      keepStoreQueryPage(PAGE, key(prev), { ref: "index:search", child: "tasks", tenant: "acme" }),
    ).toBeUndefined();
  });

  test("drops when there is no prior page", () => {
    expect(
      keepStoreQueryPage(undefined, key({ ref: "index:search" }), { ref: "index:search" }),
    ).toBeUndefined();
  });
});
