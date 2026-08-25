/**
 * Runtime auto-DDL across the widened field surface — `ensureFromMeta`
 * creates tables with the new column types on memory + pglite drivers.
 */

import { describe, expect, test } from "bun:test";
import { memorySqlDriver } from "../../drivers/memory.ts";
import { createSqlStoreHandle } from "./sql-session.ts";
import { defineTable } from "./table.ts";
import { resolveColumns } from "./table.ts";

/** TableHandle carrying sqlType metadata for DDL (declare-site shape). */
function typedTable(
  name: string,
  cols: Readonly<Record<string, string>>,
): ReturnType<typeof defineTable> {
  const base = defineTable(name, Object.fromEntries(Object.keys(cols).map((k) => [k, true])));
  return {
    ...base,
    columns: Object.fromEntries(
      Object.entries(base.columns).map(([k, v]) => [k, { ...v, sqlType: cols[k] }]),
    ),
  } as ReturnType<typeof defineTable>;
}

describe("ensureFromMeta — widened types", () => {
  test("memory driver CREATEs boolean/jsonb/uuid/timestamp columns", async () => {
    const conn = await memorySqlDriver.connect({ role: "primary" });
    const handle = createSqlStoreHandle("sql:app", {
      connection: conn,
      classifications: new Map(),
      routedRole: "primary",
      domainDdl: "ensure",
    });
    const events = typedTable("events_wide", {
      id: "uuid",
      active: "boolean",
      doc: "jsonb",
      at: "timestamp",
      day: "date",
      amount: "numeric",
      ratio: "doublePrecision",
      big: "bigserial",
      ip: "inet",
      bin: "bytea",
      loc: "point",
    });

    const cols = resolveColumns(events);
    expect(cols.find((c) => c.sqlName === "active")!.sqlType).toBe("BOOLEAN");
    expect(cols.find((c) => c.sqlName === "doc")!.sqlType).toBe("JSONB");

    await handle.insert(events).values({
      id: "e1",
      active: true,
      doc: JSON.stringify({ ok: 1 }),
      at: "2026-01-01T00:00:00Z",
      day: "2026-01-01",
      amount: "10.50",
      ratio: 0.25,
      big: 7,
      ip: "10.0.0.1",
      bin: Buffer.from("x"),
      loc: "[1,2]",
    });

    const rows = await handle.select().from(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "e1", active: true });
    await conn.close();
  });

  test("pglite driver accepts unparameterized BIGINT / BOOLEAN / JSONB DDL", async () => {
    let pglite: typeof import("../../drivers/pglite.ts");
    try {
      pglite = await import("../../drivers/pglite.ts");
    } catch {
      return; // driver optional in some environments
    }
    const conn = await pglite.pgliteDriver.connect({ role: "primary" }).catch(() => null);
    if (!conn) return;
    const handle = createSqlStoreHandle("sql:app", {
      connection: conn,
      classifications: new Map(),
      routedRole: "primary",
      domainDdl: "ensure",
    });
    const wide = typedTable("wide_pglite", {
      id: "text",
      n: "integer",
      flag: "boolean",
      payload: "jsonb",
    });
    // pglite data persists in-repo across runs — start from a clean table.
    await conn.exec(`DROP TABLE IF EXISTS "wide_pglite"`);
    await handle.insert(wide).values({ id: "r1", n: 5, flag: false, payload: '{"a":2}' });
    const rows = await handle.select().from(wide);
    expect(rows).toHaveLength(1);
    await conn.close();
  });

  test("memory parser survives comma-free numeric DDL", async () => {
    const conn = await memorySqlDriver.connect({ role: "primary" });
    const handle = createSqlStoreHandle("sql:app", {
      connection: conn,
      classifications: new Map(),
      routedRole: "primary",
      domainDdl: "ensure",
    });
    // ddlTypeOf emits NUMERIC without parens — the memory CREATE TABLE parser
    // comma-splits column defs, so numeric(p,s) would break it.
    const rates = typedTable("rates_ddl", { id: "text", rate: "numeric" });
    await handle.insert(rates).values({ id: "1", rate: "3.14" });
    const rows = await handle.select().from(rates);
    expect(rows[0]).toMatchObject({ id: "1", rate: "3.14" });
    await conn.close();
  });
});
