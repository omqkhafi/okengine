/**
 * SqlStoreHandle surface lock — single-table SQL session only.
 *
 * Relational `with:` / Drizzle RQB (`db.query.*.findMany({ with })`) is a
 * documented limitation: effects, cache keys, and PII masking assume one
 * table per call, so no relational query surface may appear on the handle.
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { and, desc, eq, like, lt, or } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sqliteDriver } from "../../drivers/sqlite.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import { createSqlStoreHandle, type SqlStoreHandle } from "./sql-session.ts";

const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
});

async function openHandle(): Promise<{ handle: SqlStoreHandle; conn: SqlConnection }> {
  const conn = await sqliteDriver.connect({
    client: new Database(":memory:"),
    role: "primary",
  });
  const handle = createSqlStoreHandle("sql:app", {
    connection: conn,
    classifications: new Map(),
    routedRole: "primary",
    domainDdl: "ensure",
  });
  return { handle, conn };
}

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

describe("SqlStoreHandle — orderBy / limit select chain", () => {
  test("orderBy + limit without where", async () => {
    const { handle, conn } = await openHandle();
    await handle.insert(posts).values({ id: "p1", title: "one", createdAt: 100 });
    await handle.insert(posts).values({ id: "p2", title: "two", createdAt: 300 });
    await handle.insert(posts).values({ id: "p3", title: "three", createdAt: 200 });

    const rows = await handle.select().from(posts).orderBy(desc(posts.createdAt)).limit(2);
    expect(rows.map((r) => r.id)).toEqual(["p2", "p3"]);
    await conn.close();
  });

  test("limit directly on from() — no where required", async () => {
    const { handle, conn } = await openHandle();
    await handle.insert(posts).values({ id: "p1", title: "one", createdAt: 100 });
    await handle.insert(posts).values({ id: "p2", title: "two", createdAt: 300 });

    const rows = await handle.select().from(posts).limit(1);
    expect(rows).toHaveLength(1);
    await conn.close();
  });

  test("composite cursor predicate: where → orderBy → limit", async () => {
    const { handle, conn } = await openHandle();
    await handle.insert(posts).values({ id: "p1", title: "one", createdAt: 100 });
    await handle.insert(posts).values({ id: "p2", title: "two", createdAt: 300 });
    await handle.insert(posts).values({ id: "p3", title: "three", createdAt: 200 });
    // Tie on createdAt=200 with an id that sorts after the cursor id.
    await handle.insert(posts).values({ id: "p0", title: "four", createdAt: 200 });

    const order = [desc(posts.createdAt), desc(posts.id)] as const;
    const page1 = await handle.select().from(posts).orderBy(...order).limit(2);
    expect(page1.map((r) => r.id)).toEqual(["p2", "p3"]);

    // (createdAt, id) < (200, "p3") — the second page of a keyset cursor.
    const page2 = await handle
      .select()
      .from(posts)
      .where(or(lt(posts.createdAt, 200), and(eq(posts.createdAt, 200), lt(posts.id, "p3"))))
      .orderBy(...order)
      .limit(2);
    expect(page2.map((r) => r.id)).toEqual(["p0", "p1"]);
    await conn.close();
  });

  test("like filters rows through the session (sqlite ASCII-insensitive)", async () => {
    const { handle, conn } = await openHandle();
    await handle.insert(posts).values({ id: "p1", title: "alpha", createdAt: 100 });
    await handle.insert(posts).values({ id: "p2", title: "bravo", createdAt: 200 });

    const rows = await handle.select().from(posts).where(like(posts.title, "A%"));
    expect(rows.map((r) => r.id)).toEqual(["p1"]);
    await conn.close();
  });
});
