/**
 * Domain DDL policy — ensure vs migrate; missing schema → OKE1101.
 */

import { describe, expect, test } from "bun:test";
import { OkeError, OKE_ERRORS } from "../../kernel/errors.ts";
import { memorySqlDriver } from "../../drivers/memory.ts";
import { defineTable } from "./table.ts";
import { createSqlStoreHandle } from "./sql-session.ts";

const notes = defineTable("notes", { id: true, title: true });

describe("domain DDL policy", () => {
  test("ensure mode creates tables on first touch", async () => {
    const conn = await memorySqlDriver.connect({ role: "primary" });
    const handle = createSqlStoreHandle("sql:app", {
      connection: conn,
      classifications: new Map(),
      routedRole: "primary",
      domainDdl: "ensure",
    });
    await handle.insert(notes).values({ id: "1", title: "hi" });
    const rows = await handle.select().from(notes);
    expect(rows).toHaveLength(1);
    await conn.close();
  });

  test("prod/off mode never CREATE TABLE IF NOT EXISTS", async () => {
    const execSql: string[] = [];
    const base = await memorySqlDriver.connect({ role: "primary" });
    const conn = {
      ...base,
      driverId: "memory" as const,
      role: "primary" as const,
      async query(sql: string, params?: readonly unknown[]) {
        execSql.push(sql);
        return base.query(sql, params);
      },
      async exec(sql: string, params?: readonly unknown[]) {
        execSql.push(sql);
        return base.exec(sql, params);
      },
      close: () => base.close(),
    };
    const handle = createSqlStoreHandle("sql:app", {
      connection: conn,
      classifications: new Map(),
      routedRole: "primary",
      domainDdl: "off",
    });
    try {
      await handle.select().from(notes);
    } catch {
      /* expected — table missing */
    }
    expect(execSql.some((s) => /CREATE TABLE IF NOT EXISTS/i.test(s))).toBe(false);
    await conn.close();
  });

  test("off mode remaps missing table to DOMAIN_SCHEMA_MISSING", async () => {
    const conn = await memorySqlDriver.connect({ role: "primary" });
    const handle = createSqlStoreHandle("sql:app", {
      connection: conn,
      classifications: new Map(),
      routedRole: "primary",
      domainDdl: "off",
    });
    let err: unknown;
    try {
      await handle.select().from(notes);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OkeError);
    const oke = err as OkeError;
    expect(oke.code).toBe(OKE_ERRORS.DOMAIN_SCHEMA_MISSING.code);
    await conn.close();
  });
});
