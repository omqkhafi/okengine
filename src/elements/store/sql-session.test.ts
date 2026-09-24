/**
 * SqlStoreHandle surface lock — single-table SQL session only.
 *
 * Relational `with:` / Drizzle RQB (`db.query.*.findMany({ with })`) is a
 * documented limitation: effects, cache keys, and PII masking assume one
 * table per call, so no relational query surface may appear on the handle.
 *
 * Upsert / orderBy / like need the real Postgres dialect (PGlite). One warmed
 * in-memory PGlite is shared for the whole file (cold WASM once); TRUNCATE
 * isolates each test without a fresh `PGlite.create`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { and, desc, eq, like, lt, or } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { pgliteDriver } from "../../drivers/pglite.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import { isFlowFailure } from "../../kernel/hooks.ts";
import { createSqlStoreHandle, type SqlStoreHandle } from "./sql-session.ts";

const posts = pgTable("posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** File-scoped warmed PGlite — opened in {@link beforeAll}. */
let sharedConn: SqlConnection;
/** Handle over {@link sharedConn}. */
let sharedHandle: SqlStoreHandle;

beforeAll(async () => {
  sharedConn = await pgliteDriver.connect({
    url: "memory://sql-session-shared",
    role: "primary",
  });
  sharedHandle = createSqlStoreHandle("sql:app", {
    connection: sharedConn,
    classifications: new Map(),
    routedRole: "primary",
    domainDdl: "ensure",
  });
  // Warm DDL via the insert path (pgTable is not a TableHandle for ensureTable).
  await sharedHandle.insert(posts).values({ id: "_warmup", title: "x", createdAt: 0 });
  await sharedConn.exec(`TRUNCATE "posts" RESTART IDENTITY CASCADE`);
}, 15_000);

afterAll(async () => {
  await sharedConn.close();
});

beforeEach(async () => {
  await sharedConn.exec(`TRUNCATE "posts" RESTART IDENTITY CASCADE`);
});

describe("SqlStoreHandle — no relational query surface (path b)", () => {
  test("created handle exposes exactly the single-table surface", () => {
    expect(Object.keys(sharedHandle).sort()).toEqual(
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
        "upsert",
        "increment",
        "raw",
        "count",
        "page",
        "ensureTable",
        "search",
      ].sort(),
    );

    // No Drizzle RQB / with: surface — ever.
    expect("query" in sharedHandle).toBe(false);
    expect("findMany" in sharedHandle).toBe(false);
    expect("findFirst" in sharedHandle).toBe(false);
    expect("with" in sharedHandle).toBe(false);
  });
});

describe("SqlStoreHandle — orderBy / limit select chain", () => {
  test("orderBy + limit without where", async () => {
    await sharedHandle.insert(posts).values({ id: "p1", title: "one", createdAt: 100 });
    await sharedHandle.insert(posts).values({ id: "p2", title: "two", createdAt: 300 });
    await sharedHandle.insert(posts).values({ id: "p3", title: "three", createdAt: 200 });

    const rows = await sharedHandle.select().from(posts).orderBy(desc(posts.createdAt)).limit(2);
    expect(rows.map((r) => r.id)).toEqual(["p2", "p3"]);
  });

  test("limit directly on from() — no where required", async () => {
    await sharedHandle.insert(posts).values({ id: "p1", title: "one", createdAt: 100 });
    await sharedHandle.insert(posts).values({ id: "p2", title: "two", createdAt: 300 });

    const rows = await sharedHandle.select().from(posts).limit(1);
    expect(rows).toHaveLength(1);
  });

  test("composite cursor predicate: where → orderBy → limit", async () => {
    await sharedHandle.insert(posts).values({ id: "p1", title: "one", createdAt: 100 });
    await sharedHandle.insert(posts).values({ id: "p2", title: "two", createdAt: 300 });
    await sharedHandle.insert(posts).values({ id: "p3", title: "three", createdAt: 200 });
    // Tie on createdAt=200 with an id that sorts after the cursor id.
    await sharedHandle.insert(posts).values({ id: "p0", title: "four", createdAt: 200 });

    const order = [desc(posts.createdAt), desc(posts.id)] as const;
    const page1 = await sharedHandle
      .select()
      .from(posts)
      .orderBy(...order)
      .limit(2);
    expect(page1.map((r) => r.id)).toEqual(["p2", "p3"]);

    // (createdAt, id) < (200, "p3") — the second page of a keyset cursor.
    const page2 = await sharedHandle
      .select()
      .from(posts)
      .where(or(lt(posts.createdAt, 200), and(eq(posts.createdAt, 200), lt(posts.id, "p3"))))
      .orderBy(...order)
      .limit(2);
    expect(page2.map((r) => r.id)).toEqual(["p0", "p1"]);
  });

  test("like filters rows through the session (postgres case-sensitive)", async () => {
    await sharedHandle.insert(posts).values({ id: "p1", title: "alpha", createdAt: 100 });
    await sharedHandle.insert(posts).values({ id: "p2", title: "bravo", createdAt: 200 });

    const rows = await sharedHandle.select().from(posts).where(like(posts.title, "a%"));
    expect(rows.map((r) => r.id)).toEqual(["p1"]);
  });
});

describe("SqlStoreHandle — upsert", () => {
  test("default inserts once then already-existed without touching the row", async () => {
    const first = await sharedHandle.upsert(
      posts,
      { id: "welcome" },
      { id: "welcome", title: "Hello", createdAt: 1 },
    );
    expect(first.status).toBe("upserted");

    const second = await sharedHandle.upsert(
      posts,
      { id: "welcome" },
      { id: "welcome", title: "Changed", createdAt: 2 },
    );
    expect(second.status).toBe("already-existed");

    const row = await sharedHandle.findById(posts, "welcome");
    expect(row).toEqual({ id: "welcome", title: "Hello", createdAt: 1 });
  });

  test("primary-key insert and update each hit the connection once", async () => {
    let queries = 0;
    const counting = {
      driverId: sharedConn.driverId,
      role: sharedConn.role,
      query(sql: string, params?: readonly unknown[]) {
        queries += 1;
        return sharedConn.query(sql, params);
      },
      exec: (sql: string, params?: readonly unknown[]) => sharedConn.exec(sql, params),
    } satisfies SqlConnection;
    const handle = createSqlStoreHandle("sql:app", {
      connection: counting,
      classifications: new Map(),
      routedRole: "primary",
      domainDdl: "off",
    });

    queries = 0;
    const inserted = await handle.upsert(
      posts,
      { id: "once" },
      { id: "once", title: "a", createdAt: 1 },
    );
    expect(inserted.status).toBe("upserted");
    expect(queries).toBe(1);

    queries = 0;
    const updated = await handle.upsert(
      posts,
      { id: "once" },
      { id: "once", title: "b", createdAt: 2 },
      { onExisting: "update" },
    );
    expect(updated.status).toBe("changed");
    expect(queries).toBe(1);

    const row = await sharedHandle.findById(posts, "once");
    expect(row).toEqual({ id: "once", title: "b", createdAt: 2 });

    queries = 0;
    const other = await handle.upsert(
      posts,
      { title: "missing" },
      { id: "other", title: "missing", createdAt: 3 },
    );
    expect(other.status).toBe("upserted");
    expect(queries).toBe(2);
  });

  test("onExisting update changes matched columns", async () => {
    await sharedHandle.upsert(posts, { id: "n1" }, { id: "n1", title: "one", createdAt: 10 });
    const updated = await sharedHandle.upsert(
      posts,
      { id: "n1" },
      { id: "n1", title: "two", createdAt: 20 },
      { onExisting: "update" },
    );
    expect(updated.status).toBe("changed");
    const row = await sharedHandle.findById(posts, "n1");
    expect(row).toEqual({ id: "n1", title: "two", createdAt: 20 });
  });
});

describe("SqlStoreHandle — SQL constraints become typed failures", () => {
  test("unique insert is Conflict; missing FK is ForeignKey", async () => {
    await sharedConn.exec(`
      CREATE TABLE IF NOT EXISTS "acct" (
        "id" TEXT PRIMARY KEY,
        "email" TEXT NOT NULL UNIQUE
      )
    `);
    await sharedConn.exec(`
      CREATE TABLE IF NOT EXISTS "note" (
        "id" TEXT PRIMARY KEY,
        "acct_id" TEXT NOT NULL REFERENCES "acct"("id")
      )
    `);
    await sharedConn.exec(`TRUNCATE "note", "acct" RESTART IDENTITY CASCADE`);

    const acct = pgTable("acct", {
      id: text("id").primaryKey(),
      email: text("email").notNull(),
    });
    const note = pgTable("note", {
      id: text("id").primaryKey(),
      acctId: text("acct_id").notNull(),
    });

    await sharedHandle.insert(acct).values({ id: "a1", email: "a@b.c" });
    let unique: unknown;
    try {
      await sharedHandle.insert(acct).values({ id: "a2", email: "a@b.c" });
    } catch (err) {
      unique = err;
    }
    expect(isFlowFailure(unique)).toBe(true);
    if (isFlowFailure(unique)) {
      expect(unique.error.code).toBe("Conflict");
      expect(JSON.stringify(unique)).not.toContain("a@b.c");
    }

    let fk: unknown;
    try {
      await sharedHandle.insert(note).values({ id: "n1", acctId: "missing" });
    } catch (err) {
      fk = err;
    }
    expect(isFlowFailure(fk)).toBe(true);
    if (isFlowFailure(fk)) {
      expect(fk.error.code).toBe("ForeignKey");
    }
  });
});
