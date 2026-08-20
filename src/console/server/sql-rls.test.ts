import { describe, expect, test } from "bun:test";
import { applySqlTableRls } from "./sql-catalog.ts";
import type { ConsoleStoreChild } from "./store.ts";

const emptyWillNot = { writerFlowIds: [], signals: [], channels: [] };
const emptyCache = {
  producedByRead: "c",
  invalidatedByWrites: [] as string[],
  invalidatingFlowIds: [] as string[],
};

function child(name: string, kind: ConsoleStoreChild["kind"] = "table"): ConsoleStoreChild {
  return {
    name,
    effectRef: `sql:${name}`,
    kind,
    writers: [],
    readers: [],
    cache: emptyCache,
    willNotFire: emptyWillNot,
    piiColumns: [],
    columnDescriptions: {},
  };
}

describe("applySqlTableRls", () => {
  test("stamps table rows and leaves catalog folders alone", () => {
    const out = applySqlTableRls(
      [child("comments"), child("customer_requests"), child("policies", "policy")],
      new Map([
        ["comments", true],
        ["customer_requests", false],
      ]),
    );
    expect(out.find((row) => row.name === "comments")?.rls).toBe(true);
    expect(out.find((row) => row.name === "customer_requests")?.rls).toBe(false);
    expect(out.find((row) => row.name === "policies")?.rls).toBeUndefined();
  });

  test("keeps an existing off flag when the engine has no live rows", () => {
    const rows = [{ ...child("comments"), rls: false }];
    expect(applySqlTableRls(rows, new Map())[0]?.rls).toBe(false);
  });

  test("Manifest declared RLS wins when live catalog is empty", () => {
    const out = applySqlTableRls([child("bookings")], new Map(), new Map([["bookings", true]]));
    expect(out[0]?.rls).toBe(true);
  });
});
