import { describe, expect, test } from "bun:test";
import {
  buildCreateIndexSql,
  DEFAULT_CREATE_INDEX_SQL,
  isCreateIndexSql,
  isSafeIndexClause,
} from "./sql-index.ts";

describe("isCreateIndexSql", () => {
  test("accepts the default template and UNIQUE", () => {
    expect(isCreateIndexSql(DEFAULT_CREATE_INDEX_SQL)).toBe(true);
    expect(isCreateIndexSql("create unique index t_email on t (email)")).toBe(true);
  });

  test("rejects other statements", () => {
    expect(isCreateIndexSql("SELECT 1")).toBe(false);
    expect(isCreateIndexSql("CREATE FUNCTION f() RETURNS void AS $$ $$")).toBe(false);
    expect(isCreateIndexSql("")).toBe(false);
  });
});

describe("buildCreateIndexSql", () => {
  test("pretty-prints a single-column B-tree", () => {
    expect(
      buildCreateIndexSql({
        name: "comments_created_at_idx",
        table: "comments",
        columns: "created_at",
      }),
    ).toBe(
      ['CREATE INDEX "comments_created_at_idx"', '  ON "comments"', '  ("created_at");'].join("\n"),
    );
  });

  test("adds UNIQUE, GIN, IF NOT EXISTS, expressions, and WHERE", () => {
    expect(
      buildCreateIndexSql({
        name: "events_payload_gin",
        table: "events",
        columns: "payload, lower(email)",
        method: "gin",
        unique: true,
        ifNotExists: true,
        where: "deleted_at IS NULL",
      }),
    ).toBe(
      [
        'CREATE UNIQUE INDEX IF NOT EXISTS "events_payload_gin"',
        '  ON "events" USING gin',
        '  ("payload", lower(email))',
        "  WHERE deleted_at IS NULL;",
      ].join("\n"),
    );
  });

  test("adds CONCURRENTLY, INCLUDE, NULLS NOT DISTINCT, and WITH", () => {
    expect(
      buildCreateIndexSql({
        name: "comments_cover",
        table: "comments",
        columns: "created_at",
        concurrently: true,
        include: "body",
        nullsNotDistinct: true,
        with: "fillfactor = 70",
      }),
    ).toBe(
      [
        'CREATE INDEX CONCURRENTLY "comments_cover"',
        '  ON "comments"',
        '  ("created_at")',
        '  INCLUDE ("body")',
        "  NULLS NOT DISTINCT",
        "  WITH (fillfactor = 70);",
      ].join("\n"),
    );
  });

  test("omits unsafe columns and WHERE", () => {
    const sql = buildCreateIndexSql({
      name: "t",
      table: "bookings",
      columns: "email; DROP TABLE bookings",
      where: "true; SELECT 1",
    });
    expect(sql).toContain('("column_name")');
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("WHERE");
  });
});

describe("isSafeIndexClause", () => {
  test("allows a column list", () => {
    expect(isSafeIndexClause("email, created_at DESC")).toBe(true);
  });

  test("rejects stacking and comments", () => {
    expect(isSafeIndexClause("email; SELECT 1")).toBe(false);
    expect(isSafeIndexClause("email -- x")).toBe(false);
  });
});
