/**
 * prepareInsertRow / prepareUpdateRow — temporal bind coercion.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { lte } from "drizzle-orm";
import { timestamp, text, pgTable, integer } from "drizzle-orm/pg-core";
import { pgliteDriver } from "../../drivers/pglite.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import { field, store } from "../store.ts";
import { createSqlStoreHandle, type SqlStoreHandle } from "./sql-session.ts";
import { coerceTemporalBindValue, prepareInsertRow, prepareUpdateRow } from "./table.ts";

describe("coerceTemporalBindValue", () => {
  test("epoch-ms number → Date for TIMESTAMP and DATE", () => {
    const at = coerceTemporalBindValue("TIMESTAMP", 1_700_000_000_000);
    expect(at).toBeInstanceOf(Date);
    expect((at as Date).getTime()).toBe(1_700_000_000_000);

    const day = coerceTemporalBindValue("DATE", 0);
    expect(day).toBeInstanceOf(Date);
    expect((day as Date).getTime()).toBe(0);
  });

  test("ISO datetime string → Date for TIMESTAMP and DATE", () => {
    const at = coerceTemporalBindValue("TIMESTAMP", "2024-01-01T00:00:00.000Z");
    expect(at).toBeInstanceOf(Date);
    expect((at as Date).toISOString()).toBe("2024-01-01T00:00:00.000Z");

    const day = coerceTemporalBindValue("DATE", "2024-01-01T00:00:00.000Z");
    expect(day).toBeInstanceOf(Date);
    expect((day as Date).toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  test("leaves non-temporal and unparseable values alone", () => {
    expect(coerceTemporalBindValue("INTEGER", 42)).toBe(42);
    expect(coerceTemporalBindValue("TIMESTAMP", "not-an-instant")).toBe("not-an-instant");
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

  test("abstract schema: insert coerces ISO datetime on timestamp columns", () => {
    const prepared = prepareInsertRow(notes, {
      id: "welcome",
      createdAt: "2026-09-14T12:00:00.000Z",
      archivedAt: null,
    });
    expect(prepared.created_at).toBeInstanceOf(Date);
    expect((prepared.created_at as Date).toISOString()).toBe("2026-09-14T12:00:00.000Z");
    expect(prepared.archived_at).toBe(null);
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
    await handle.insert(notesTs).values({ id: "_warmup", title: "x", createdAt: new Date(0) });
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

  test("select/update WHERE coerces epoch-ms on timestamp columns", async () => {
    await handle.insert(notesTs).values({ id: "old", title: "old", createdAt: 1 });
    await handle.insert(notesTs).values({ id: "new", title: "new", createdAt: 100 });

    // Drizzle types timestamp `{ mode: "date" }` as Date; the store still
    // coerces epoch-ms binds (`fx.clock.now()`) at WHERE compile time.
    const before = 50 as unknown as Date;
    const rows = await handle.select().from(notesTs).where(lte(notesTs.createdAt, before));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("old");

    const n = await handle
      .update(notesTs)
      .set({ title: "archived" })
      .where(lte(notesTs.createdAt, before));
    expect(n).toBe(1);
    const archived = await handle.findById(notesTs, "old");
    expect(archived?.title).toBe("archived");
  });

  test("upsert accepts ISO datetime strings without Postgres type error", async () => {
    const first = await handle.upsert(
      notesTs,
      { id: "welcome" },
      { id: "welcome", title: "Welcome", createdAt: "2026-09-14T12:00:00.000Z" },
    );
    expect(first.status).toBe("upserted");

    const rows = await handle.select().from(notesTs);
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]!.createdAt as Date).toISOString()).toBe("2026-09-14T12:00:00.000Z");
  });
});
