import { describe, expect, test } from "bun:test";
import { completeQuery, type SqlCompletion } from "./sql-complete.ts";
import type { QuerySchemaTable } from "./query-schema.ts";

const TABLES: readonly QuerySchemaTable[] = [
  {
    name: "comments",
    columns: [
      { name: "id", type: "string", primaryKey: true },
      { name: "author_email", type: "string", pii: true },
      { name: "body", type: "string" },
    ],
  },
  {
    name: "cycles",
    columns: [
      { name: "id", type: "string", primaryKey: true },
      { name: "name", type: "string" },
    ],
  },
];

function labels(items: readonly SqlCompletion[]): string[] {
  return items.map((item) => item.label);
}

function kinds(items: readonly SqlCompletion[], kind: SqlCompletion["kind"]): string[] {
  return items.filter((item) => item.kind === kind).map((item) => item.label);
}

describe("completeQuery SQL", () => {
  test("FROM prefix suggests matching tables", () => {
    const sql = `SELECT * FROM com`;
    const result = completeQuery(sql, sql.length, TABLES);
    expect(result).not.toBeNull();
    expect(kinds(result!.items, "table")).toEqual(["comments"]);
    expect(result!.items[0]?.insert).toBe(`"comments"`);
  });

  test("quoted table prefix still matches", () => {
    const sql = `SELECT * FROM "com`;
    const result = completeQuery(sql, sql.length, TABLES);
    expect(kinds(result!.items, "table")).toEqual(["comments"]);
    expect(result!.from).toBe(sql.indexOf(`"`));
  });

  test("SELECT prefix suggests columns and keywords", () => {
    const sql = `SELECT au`;
    const result = completeQuery(sql, sql.length, TABLES);
    expect(kinds(result!.items, "column")).toEqual(["author_email"]);
    expect(kinds(result!.items, "keyword")).toEqual([]);
  });

  test("qualified table.column suggests that table's columns", () => {
    const sql = `SELECT comments.au`;
    const result = completeQuery(sql, sql.length, TABLES);
    expect(kinds(result!.items, "column")).toEqual(["author_email"]);
    expect(result!.from).toBe(sql.indexOf("au"));
  });

  test("WHERE after FROM prefers columns of the referenced table", () => {
    const sql = `SELECT * FROM "comments" WHERE `;
    const result = completeQuery(sql, sql.length, TABLES);
    expect(kinds(result!.items, "column").slice(0, 3)).toEqual(["author_email", "body", "id"]);
  });

  test("start of statement suggests keywords", () => {
    const sql = `SEL`;
    const result = completeQuery(sql, sql.length, TABLES);
    expect(kinds(result!.items, "keyword")).toContain("SELECT");
  });

  test("DDL and EXPLAIN prefixes suggest keywords", () => {
    expect(kinds(completeQuery("CRE", 3, TABLES)!.items, "keyword")).toContain("CREATE TABLE");
    expect(kinds(completeQuery("EXP", 3, TABLES)!.items, "keyword")).toContain("EXPLAIN");
    expect(kinds(completeQuery("EXP", 3, TABLES)!.items, "keyword")).toContain("EXPLAIN ANALYZE");
  });

  test("does not complete inside a string literal", () => {
    const sql = `SELECT * FROM comments WHERE body = 'com`;
    expect(completeQuery(sql, sql.length, TABLES)).toBeNull();
  });
});

describe("completeQuery KV", () => {
  test("bare prefix suggests commands and namespaces", () => {
    const result = completeQuery("li", 2, TABLES, "kv");
    expect(kinds(result!.items, "command")).toEqual(["list"]);
    expect(kinds(result!.items, "namespace")).toEqual([]);
  });

  test("set is a command", () => {
    const result = completeQuery("se", 2, TABLES, "kv");
    expect(kinds(result!.items, "command")).toEqual(["set"]);
    expect(result!.items[0]?.insert).toBe("set(");
  });

  test("delete and ttl are commands", () => {
    expect(kinds(completeQuery("de", 2, TABLES, "kv")!.items, "command")).toEqual(["delete"]);
    expect(kinds(completeQuery("tt", 2, TABLES, "kv")!.items, "command")).toEqual(["ttl"]);
  });

  test("list prefix suggests namespaces", () => {
    const text = "list cy";
    const result = completeQuery(text, text.length, TABLES, "kv");
    expect(labels(result!.items)).toEqual(["cycles"]);
    expect(result!.items[0]?.insert).toBe("cycles:");
  });
});
