/**
 * prepareInsertRow / prepareUpdateRow — temporal bind coercion.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { timestamp, text, pgTable, integer } from "drizzle-orm/pg-core";
import { pgliteDriver } from "../../drivers/pglite.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import { field, store } from "../store.ts";
import { createSqlStoreHandle, type SqlStoreHandle } from "./sql-session.ts";
import {
  coerceTemporalBindValue,
  prepareInsertRow,
  prepareUpdateRow,
} from "./table.ts";

describe("coerceTemporalBindValue", () => {
  test("epoch-ms number → Date for TIMESTAMP and DATE", () => {
    const at = coerceTemporalBindValue("TIMESTAMP", 1_700_000_000_000);
    expect(at).toBeInstanceOf(Date);
    expect((at as Date).getTime()).toBe(1_700_000_000_000);

    const day = coerceTemporalBindValue("DATE", 0);
    expect(day).toBeInstanceOf(Date);
    expect((day as Date).getTime()).toBe(0);
  });

  test("leaves non-temporal and non-number values alone", () => {
    expect(coerceTemporalBindValue("INTEGER", 42)).toBe(42);
    expect(coerceTemporalBindValue("TIMESTAMP", "2024-01-01T00:00:00.000Z")).toBe(
      "2024-01-01T00:00:00.000Z",
    );
    const d = new Date(5);
    expect(coerceTemporalBindValue("TIMESTAMP", d)).toBe(d);
    expect(coerceTemporalBindValue("TIMESTAMP", null)).toBe(null);
    expect(coerceTemporalBindValue("TIMESTAMP", Number.NaN)).toBe(Number.NaN);
  });
});

describe("prepareInsertRow / prepareUpdateRow — timestamp columns", () => {
  const notes = store.schema.table("notes", {
    id: field.id().primaryKey(),
    createdAt: field.timestamp().notNull(),
    archivedAt: field.timestamp(),
  });

  test("abstract schema: insert coerces epoch-ms on timestamp columns", () => {
    const prepared = prepareInsertRow(notes, {
      id: "welcome",
      createdAt: 1,
      archivedAt: null,
    });
    expect(prepared.created_at).toBeInstanceOf(Date);
    expect((prepared.created_at as Date).getTime()).toBe(1);
    expect(prepared.archived_at).toBe(null);
    expect(prepared.id).toBe("welcome");
  });

  test("abstract schema: update coerces epoch-ms on timestamp columns", () => {
    const prepared = prepareUpdateRow(notes, { archivedAt: 99 });
    expect(prepared.archived_at).toBeInstanceOf(Date);
    expect((prepared.archived_at as Date).getTime()).toBe(99);
  });

  test("drizzle pgTable timestamp: insert coerces epoch-ms", () => {
    const posts = pgTable("posts", {
      id: text("id").primaryKey(),
      createdAt: timestamp("created_at", { mode: "date" }).notNull(),
      hits: integer("hits").notNull(),
    });
    const prepared = prepareInsertRow(posts, {
      id: "p1",
      createdAt: 42,
      hits: 7,
    });
    expect(prepared.created_at).toBeInstanceOf(Date);
    expect((prepared.created_at as Date).getTime()).toBe(42);
    expect(prepared.hits).toBe(7);
  });
});

describe("SqlStoreHandle upsert — epoch-ms into timestamp (Postgres)", () => {
  const notesTs = pgTable("notes_ts", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  });

  let conn: SqlConnection;
  let handle: SqlStoreHandle;

  beforeAll(async () => {
    conn = await pgliteDriver.connect({
      url: "memory://prepare-row-ts",
      role: "primary",
    });
    handle = createSqlStoreHandle("sql:app", {
      connection: conn,
      classifications: new Map(),
      routedRole: "primary",
      domainDdl: "ensure",
    });
    await handle
      .insert(notesTs)
      .values({ id: "_warmup", title: "x", createdAt: new Date(0) });
    await conn.exec(`TRUNCATE "notes_ts" RESTART IDENTITY CASCADE`);
  }, 15_000);

  afterAll(async () => {
    await conn.close();
  });

  beforeEach(async () => {
    await conn.exec(`TRUNCATE "notes_ts" RESTART IDENTITY CASCADE`);
  });

  test("upsert accepts fx.clock.now()-style epoch-ms without Postgres type error", async () => {
    const first = await handle.upsert(
      notesTs,
      { id: "welcome" },
      { id: "welcome", title: "Welcome", createdAt: 1 },
    );
    expect(first.status).toBe("upserted");

    const rows = await handle.select().from(notesTs);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.createdAt)).toBe(1);
  });
});
