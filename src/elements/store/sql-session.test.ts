/**
 * SqlStoreHandle surface lock — single-table SQL session only.
 *
 * Relational `with:` / Drizzle RQB (`db.query.*.findMany({ with })`) is a
 * documented limitation: effects, cache keys, and PII masking assume one
 * table per call, so no relational query surface may appear on the handle.
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { sqliteDriver } from "../../drivers/sqlite.ts";
import { createSqlStoreHandle } from "./sql-session.ts";

describe("SqlStoreHandle — no relational query surface (path b)", () => {
  test("created handle exposes exactly the single-table surface", async () => {
    const db = new Database(":memory:");
    const conn = await sqliteDriver.connect({ client: db, role: "primary" });
    const handle = createSqlStoreHandle("sql:app", {
      connection: conn,
      classifications: new Map(),
      routedRole: "primary",
      domainDdl: "ensure",
    });

    expect(Object.keys(handle).sort()).toEqual(
      [
        "ref",
        "routedRole",
        "driverId",
        "select",
        "insert",
        "update",
        "findById",
        "delete",
        "exists",
        "increment",
        "raw",
        "ensureTable",
      ].sort(),
    );

    // No Drizzle RQB / with: surface — ever.
    expect("query" in handle).toBe(false);
    expect("findMany" in handle).toBe(false);
    expect("findFirst" in handle).toBe(false);
    expect("with" in handle).toBe(false);

    await conn.close();
  });
});
