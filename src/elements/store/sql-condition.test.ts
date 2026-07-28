/**
 * Drizzle condition compiler — parenthesized `or`/`and` groups, `like` /
 * `ilike`, loud failures on unsupported operators, and `orderBy` terms.
 */

import { describe, expect, test } from "bun:test";
import {
  and,
  asc,
  between,
  desc,
  eq,
  ilike,
  isNull,
  like,
  lt,
  not,
  or,
  sql,
} from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { compileOrderBy, compileWhere } from "./sql-condition.ts";

const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
});

describe("compileWhere", () => {
  test("bare comparison stays unparenthesized", () => {
    const c = compileWhere(eq(notes.id, "n1"));
    expect(c.clause).toBe(`"id" = ?`);
    expect(c.params).toEqual(["n1"]);
  });

  test("like compiles to LIKE + bound pattern", () => {
    const c = compileWhere(like(notes.title, "%hello%"));
    expect(c.clause).toBe(`"title" like ?`);
    expect(c.params).toEqual(["%hello%"]);
  });

  test("ilike compiles to ILIKE + bound pattern (postgres parity)", () => {
    const c = compileWhere(ilike(notes.title, "%Hello%"));
    expect(c.clause).toBe(`"title" ilike ?`);
    expect(c.params).toEqual(["%Hello%"]);
  });

  test("and joins with AND", () => {
    const c = compileWhere(and(eq(notes.id, "n1"), eq(notes.title, "t")));
    expect(c.clause).toBe(`("id" = ?) AND ("title" = ?)`);
    expect(c.params).toEqual(["n1", "t"]);
  });

  test("or produces a parenthesized OR group — never flattened into AND", () => {
    const c = compileWhere(or(eq(notes.id, "n1"), lt(notes.createdAt, 10)));
    expect(c.clause).toBe(`("id" = ?) OR ("created_at" < ?)`);
    expect(c.params).toEqual(["n1", 10]);
  });

  test("composite cursor predicate keeps OR/AND precedence", () => {
    const c = compileWhere(
      and(
        like(notes.title, "%x%"),
        or(lt(notes.createdAt, 100), and(eq(notes.createdAt, 100), lt(notes.id, "n1"))),
      ),
    );
    expect(c.clause).toBe(
      `("title" like ?) AND (("created_at" < ?) OR (("created_at" = ?) AND ("id" < ?)))`,
    );
    expect(c.params).toEqual(["%x%", 100, 100, "n1"]);
    expect(c.predicates.map((p) => p.op)).toEqual(["like", "<", "=", "<"]);
  });

  test("single-condition or() collapses to the leaf", () => {
    const c = compileWhere(or(eq(notes.id, "n1")));
    expect(c.clause).toBe(`"id" = ?`);
    expect(c.params).toEqual(["n1"]);
  });

  test("plain equality maps are unchanged", () => {
    const c = compileWhere({ id: "n1", title: "t" });
    expect(c.clause).toBe(`"id" = ? AND "title" = ?`);
    expect(c.params).toEqual(["n1", "t"]);
  });

  test("unsupported operators fail loudly instead of dropping predicates", () => {
    expect(() => compileWhere(between(notes.createdAt, 1, 2))).toThrow(/unsupported operator/);
    expect(() => compileWhere(isNull(notes.title))).toThrow(/unsupported operator/);
    expect(() => compileWhere(not(eq(notes.id, "n1")))).toThrow(/unsupported fragment/);
    expect(() => compileWhere(sql`title = 1`)).toThrow(/unsupported fragment/);
  });
});

describe("compileOrderBy", () => {
  test("asc/desc terms with bare-column default", () => {
    const terms = compileOrderBy([desc(notes.createdAt), asc(notes.id), notes.title]);
    expect(terms).toEqual([
      { column: "created_at", direction: "DESC" },
      { column: "id", direction: "ASC" },
      { column: "title", direction: "ASC" },
    ]);
  });

  test("garbage terms fail loudly", () => {
    expect(() => compileOrderBy([sql`random()`])).toThrow(/orderBy/);
    expect(() => compileOrderBy([42])).toThrow(/orderBy/);
  });
});
