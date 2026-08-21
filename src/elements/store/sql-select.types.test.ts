/**
 * Type-level proof: `select().from(store.schema.table())` resolves to the
 * declared column JS shape — not `SqlRow`.
 */
import { describe, expect, test } from "bun:test";

import type { SqlRow } from "../../drivers/types.ts";
import { field, schemaTable } from "./schema-decl.ts";
import type { InferSelectRow, SqlStoreHandle } from "./sql-session.ts";
import { defineTable } from "./table.ts";

/** Compile-time equality. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

const items = schemaTable("items", {
  id: field.text().primaryKey(),
  title: field.text().notNull(),
  note: field.text(),
  count: field.integer().notNull(),
  score: field.integer(),
});

type ExpectedRow = {
  id: string;
  title: string;
  note: string | null;
  count: number;
  score: number | null;
};

async function selectAll(db: SqlStoreHandle) {
  return db.select().from(items);
}

async function selectWhere(db: SqlStoreHandle) {
  return db.select().from(items).where({ id: "x" });
}

async function selectOrder(db: SqlStoreHandle) {
  return db.select().from(items).orderBy(items.title);
}

async function selectLimit(db: SqlStoreHandle) {
  return db.select().from(items).limit(1);
}

async function selectProj(db: SqlStoreHandle) {
  return db.select({ title: items.title }).from(items);
}

const bare = defineTable("bare", { id: { name: "id" } });

async function selectBare(db: SqlStoreHandle) {
  return db.select().from(bare);
}

type _Infer = Assert<Eq<InferSelectRow<typeof items>, ExpectedRow>>;
type _All = Assert<Eq<Awaited<ReturnType<typeof selectAll>>, ExpectedRow[]>>;
type _Where = Assert<Eq<Awaited<ReturnType<typeof selectWhere>>, ExpectedRow[]>>;
type _Order = Assert<Eq<Awaited<ReturnType<typeof selectOrder>>, ExpectedRow[]>>;
type _Limit = Assert<Eq<Awaited<ReturnType<typeof selectLimit>>, ExpectedRow[]>>;
type _Proj = Assert<Eq<Awaited<ReturnType<typeof selectProj>>, SqlRow[]>>;
type _Bare = Assert<Eq<Awaited<ReturnType<typeof selectBare>>, SqlRow[]>>;

describe("select().from() row inference", () => {
  test("type-level row shape matches declared columns", () => {
    const _keep: _Infer & _All & _Where & _Order & _Limit & _Proj & _Bare = true;
    expect(_keep).toBe(true);
  });
});
