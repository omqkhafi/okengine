/**
 * `store.resource` row shape — declared JS keys only, never raw SQL names.
 * Also locks the PII-masking order: mask after remapping so a `.pii()` column
 * whose TS key differs from its SQL name cannot leak cleartext under the
 * client-facing key.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";
import { pgliteDriver } from "../../drivers/pglite.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import { oke } from "../../kernel/app.ts";
import { resetFlowSeq } from "../../kernel/flow.ts";
import { on, resetBindings } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
import { createTestApp } from "../../test/create-test-app.ts";
import { classify, field, id, now, PII_MASK, store } from "../store.ts";
import { createSqlStoreHandle, type SqlStoreHandle } from "./sql-session.ts";
import { mapRowToJs, resolveColumns } from "./table.ts";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

/** Posts table for the JS-key exit lock (needs real Postgres dialect via PGlite). */
const jsKeyPosts = pgTable("posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** File-scoped warmed PGlite for the SqlStoreHandle exit describe. */
let sharedConn: SqlConnection;
/** Handle over {@link sharedConn}. */
let sharedHandle: SqlStoreHandle;

describe("mapRowToJs — declared keys only", () => {
  const posts = pgTable("posts", {
    id: text("id").primaryKey(),
    createdAt: integer("created_at").notNull(),
  });

  test("SQL-keyed driver row becomes JS keys; raw SQL name is dropped", () => {
    const cols = resolveColumns(posts);
    expect(cols.find((c) => c.key === "createdAt")?.sqlName).toBe("created_at");

    const mapped = mapRowToJs(posts, { id: "p1", created_at: 100 });
    expect(mapped).toEqual({ id: "p1", createdAt: 100 });
    expect("created_at" in mapped).toBe(false);
  });

  test("already JS-keyed row prefers JS key; raw SQL name is dropped", () => {
    const mapped = mapRowToJs(posts, { id: "p1", createdAt: 100, created_at: 999 });
    expect(mapped).toEqual({ id: "p1", createdAt: 100 });
    expect("created_at" in mapped).toBe(false);
  });
});

describe("SqlStoreHandle exit — list/get/create return JS keys only", () => {
  // Real Postgres dialect (PGlite) — share one warmed instance; TRUNCATE between tests.
  beforeAll(async () => {
    sharedConn = await pgliteDriver.connect({
      url: "memory://resource-js-keys-shared",
      role: "primary",
    });
    sharedHandle = createSqlStoreHandle("sql:app", {
      connection: sharedConn,
      classifications: new Map(),
      routedRole: "primary",
      domainDdl: "ensure",
    });
    // Warm DDL via the insert path (pgTable is not a TableHandle for ensureTable).
    await sharedHandle.insert(jsKeyPosts).values({ id: "_warmup", title: "x", createdAt: 0 });
    await sharedConn.exec(`TRUNCATE "posts" RESTART IDENTITY CASCADE`);
  }, 15_000);

  afterAll(async () => {
    await sharedConn.close();
  });

  beforeEach(async () => {
    await sharedConn.exec(`TRUNCATE "posts" RESTART IDENTITY CASCADE`);
  });

  test("select / findById / insert.returning never emit created_at", async () => {
    const [created] = await sharedHandle
      .insert(jsKeyPosts)
      .values({ id: "p1", title: "one", createdAt: 100 })
      .returning();
    expect(Object.keys(created!).sort()).toEqual(["createdAt", "id", "title"]);
    expect("created_at" in created!).toBe(false);

    const listed = await sharedHandle.select().from(jsKeyPosts);
    expect(Object.keys(listed[0]!).sort()).toEqual(["createdAt", "id", "title"]);
    expect("created_at" in listed[0]!).toBe(false);

    const got = await sharedHandle.findById(jsKeyPosts, "p1");
    expect(Object.keys(got!).sort()).toEqual(["createdAt", "id", "title"]);
    expect("created_at" in got!).toBe(false);
  });
});

describe("resource HTTP — exact keys + PII with differing TS/SQL names", () => {
  // TS `email` ↔ SQL `email_addr`; TS `createdAt` ↔ SQL `created_at`.
  const contacts = pgTable("contacts", {
    id: text("id").primaryKey().$defaultFn(id),
    email: text("email_addr").notNull(),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  });

  const NewContact = createInsertSchema(contacts).omit({ id: true, createdAt: true });
  const Contact = createSelectSchema(contacts);

  function buildApp() {
    resetBindings();
    resetFlowSeq();

    const db = store.sql("contacts", {
      schema: { contacts },
      classify: { contacts: { email: classify({ pii: true }) } },
    });

    const contactsR = store.resource(db, contacts, {
      in: NewContact,
      out: Contact,
      update: NewContact.partial(),
      list: {
        cursor: [contacts.createdAt, contacts.id],
        direction: "desc",
        limit: 20,
        filter: "all",
        order: "all",
      },
      breaking: true,
    });

    const mounted = on(http.resource("/contacts", contactsR.all()));
    const app = oke({ name: "contacts-resource-test" }).adopt({ contacts: mounted });
    Object.assign(app.$options, {
      env: "test",
      stores: [db],
      config: { drivers: { store: { sql: { test: "pglite" } } } },
    });
    return app;
  }

  /** Assert a row object has exactly the declared keys — no raw SQL names. */
  function expectExactContactKeys(row: Record<string, unknown>) {
    expect(Object.keys(row).sort()).toEqual(["createdAt", "email", "id"]);
    expect("created_at" in row).toBe(false);
    expect("email_addr" in row).toBe(false);
  }

  test("app.fetch list/get/create/update: only createdAt + masked email, never raw SQL keys", async () => {
    const app = buildApp();
    const t = await createTestApp(app);

    // create → 201
    const created = await app.fetch(
      new Request("http://localhost/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "secret@example.com" }),
      }),
    );
    expect(created.status).toBe(201);
    const createdText = await created.text();
    expect(createdText).not.toContain("created_at");
    expect(createdText).not.toContain("email_addr");
    expect(createdText).not.toContain("secret@example.com");
    const createdBody = JSON.parse(createdText) as {
      data: Record<string, unknown>;
      error: null;
    };
    expect(createdBody.error).toBeNull();
    expectExactContactKeys(createdBody.data);
    expect(createdBody.data.email).toBe(PII_MASK);
    expect(typeof createdBody.data.createdAt).toBe("number");
    const contactId = createdBody.data.id as string;

    // get → 200
    const got = await app.fetch(new Request(`http://localhost/contacts/${contactId}`));
    expect(got.status).toBe(200);
    const gotText = await got.text();
    expect(gotText).not.toContain("created_at");
    expect(gotText).not.toContain("email_addr");
    expect(gotText).not.toContain("secret@example.com");
    const gotBody = JSON.parse(gotText) as { data: Record<string, unknown> };
    expectExactContactKeys(gotBody.data);
    expect(gotBody.data.email).toBe(PII_MASK);

    // list → 200 (query present so list `in` is a record, not undefined)
    const list = await app.fetch(new Request("http://localhost/contacts?limit=20"));
    expect(list.status).toBe(200);
    const listText = await list.text();
    expect(listText).not.toContain("created_at");
    expect(listText).not.toContain("email_addr");
    expect(listText).not.toContain("secret@example.com");
    const listBody = JSON.parse(listText) as { data: Record<string, unknown>[] };
    expect(listBody.data).toHaveLength(1);
    expectExactContactKeys(listBody.data[0]!);
    expect(listBody.data[0]!.email).toBe(PII_MASK);
    const listMeta = JSON.parse(listText) as {
      meta: {
        next: { cursor: string } | null;
        prev: { cursor: string } | null;
      };
    };
    expect(listMeta.meta.next).toBeNull();
    expect(listMeta.meta.prev).toBeNull();

    // update → 200
    const updated = await app.fetch(
      new Request(`http://localhost/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "other@example.com" }),
      }),
    );
    expect(updated.status).toBe(200);
    const updatedText = await updated.text();
    expect(updatedText).not.toContain("created_at");
    expect(updatedText).not.toContain("email_addr");
    expect(updatedText).not.toContain("other@example.com");
    const updatedBody = JSON.parse(updatedText) as { data: Record<string, unknown> };
    expectExactContactKeys(updatedBody.data);
    expect(updatedBody.data.email).toBe(PII_MASK);

    await t.close();
  });

  test("list cursor meta walks next and previous", async () => {
    const app = buildApp();
    const t = await createTestApp(app);
    for (const email of ["a@example.com", "b@example.com", "c@example.com"]) {
      const created = await app.fetch(
        new Request("http://localhost/contacts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        }),
      );
      expect(created.status).toBe(201);
    }

    type ListBody = {
      data: Array<{ id: string }>;
      meta: {
        next: { cursor: string } | null;
        prev: { cursor: string } | null;
      };
    };

    const page1 = (await (
      await app.fetch(new Request("http://localhost/contacts?limit=1"))
    ).json()) as ListBody;
    expect(page1.data).toHaveLength(1);
    expect(page1.meta.next?.cursor).toBeString();
    expect(page1.meta.prev).toBeNull();

    const page2 = (await (
      await app.fetch(
        new Request(
          `http://localhost/contacts?limit=1&cursor=${encodeURIComponent(page1.meta.next!.cursor)}`,
        ),
      )
    ).json()) as ListBody;
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0]!.id).not.toBe(page1.data[0]!.id);
    expect(page2.meta.prev?.cursor).toBeString();

    const back = (await (
      await app.fetch(
        new Request(
          `http://localhost/contacts?limit=1&cursor=${encodeURIComponent(page2.meta.prev!.cursor)}`,
        ),
      )
    ).json()) as ListBody;
    expect(back.data[0]!.id).toBe(page1.data[0]!.id);
    expect(back.meta.prev).toBeNull();
    expect(back.meta.next).not.toBeNull();

    await t.close();
  });

  test("schema-decl .pii().as(sqlName) masks the final JS key via app.fetch", async () => {
    resetBindings();
    resetFlowSeq();

    const peopleTable = store.schema.table("people", {
      id: field.text().primaryKey().defaultFn(id),
      email: field.text().notNull().pii().as("email_addr"),
      createdAt: field.integer().notNull().defaultFn(now),
    });

    const db = store.sql("people", { schema: { people: peopleTable } });
    const peopleR = store.resource(db, peopleTable, {
      in: z.object({ email: z.string().email() }),
      out: z.object({
        id: z.string(),
        email: z.string(),
        createdAt: z.number(),
      }),
      update: z.object({ email: z.string().email() }).partial(),
      list: { mode: "offset", limit: 20 },
      breaking: true,
    });

    const mounted = on(http.resource("/people", peopleR.all()));
    const app = oke({ name: "people-pii-test" }).adopt({ people: mounted });
    Object.assign(app.$options, {
      env: "test",
      stores: [db],
      config: { drivers: { store: { sql: { test: "pglite" } } } },
    });

    const t = await createTestApp(app);
    const created = await app.fetch(
      new Request("http://localhost/people", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com" }),
      }),
    );
    expect(created.status).toBe(201);
    const text = await created.text();
    expect(text).not.toContain("email_addr");
    expect(text).not.toContain("created_at");
    expect(text).not.toContain("alice@example.com");
    const body = JSON.parse(text) as { data: Record<string, unknown> };
    expect(Object.keys(body.data).sort()).toEqual(["createdAt", "email", "id"]);
    expect(body.data.email).toBe(PII_MASK);

    await t.close();
  });
});
