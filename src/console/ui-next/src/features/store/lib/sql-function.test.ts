import { describe, expect, test } from "bun:test";
import {
  buildCreateFunctionSql,
  DEFAULT_CREATE_FUNCTION_SQL,
  extractFunctionBody,
  isCreateFunctionSql,
  isSafeFunctionClause,
} from "./sql-function.ts";

describe("isCreateFunctionSql", () => {
  test("accepts the default template and OR REPLACE", () => {
    expect(isCreateFunctionSql(DEFAULT_CREATE_FUNCTION_SQL)).toBe(true);
    expect(isCreateFunctionSql("create or replace function foo() returns void as $$ $$")).toBe(
      true,
    );
  });

  test("rejects other statements", () => {
    expect(isCreateFunctionSql("SELECT 1")).toBe(false);
    expect(isCreateFunctionSql("CREATE TABLE t (id text)")).toBe(false);
    expect(isCreateFunctionSql("")).toBe(false);
  });
});

describe("buildCreateFunctionSql", () => {
  test("pretty-prints PL/pgSQL void", () => {
    expect(
      buildCreateFunctionSql({
        name: "function_name",
        args: "",
        returns: "void",
        language: "plpgsql",
        body: "BEGIN\n  -- Write your function logic here\nEND;",
      }),
    ).toBe(
      [
        'CREATE FUNCTION "function_name"()',
        "RETURNS void",
        "LANGUAGE plpgsql",
        "AS $$",
        "BEGIN",
        "  -- Write your function logic here",
        "END;",
        "$$;",
      ].join("\n"),
    );
  });

  test("adds args, IMMUTABLE, schema name, and OR REPLACE", () => {
    expect(
      buildCreateFunctionSql({
        name: "public.norm",
        args: "value text",
        returns: "text",
        language: "sql",
        volatility: "IMMUTABLE",
        orReplace: true,
        body: "  SELECT $1;",
      }),
    ).toBe(
      [
        'CREATE OR REPLACE FUNCTION "public"."norm"(value text)',
        "RETURNS text",
        "LANGUAGE sql",
        "IMMUTABLE",
        "AS $$",
        "  SELECT $1;",
        "$$;",
      ].join("\n"),
    );
  });

  test("adds SECURITY DEFINER, STRICT, PARALLEL, COST, and search_path", () => {
    expect(
      buildCreateFunctionSql({
        name: "norm",
        args: "value text",
        returns: "text",
        language: "sql",
        volatility: "IMMUTABLE",
        security: "DEFINER",
        strict: true,
        leakproof: true,
        parallel: "SAFE",
        cost: 10,
        rows: 1,
        searchPath: "public",
        body: "  SELECT $1;",
      }),
    ).toBe(
      [
        'CREATE FUNCTION "norm"(value text)',
        "RETURNS text",
        "LANGUAGE sql",
        "IMMUTABLE",
        "LEAKPROOF",
        "STRICT",
        "SECURITY DEFINER",
        "PARALLEL SAFE",
        "COST 10",
        "ROWS 1",
        "SET search_path TO public",
        "AS $$",
        "  SELECT $1;",
        "$$;",
      ].join("\n"),
    );
  });

  test("drops unsafe args and RETURNS", () => {
    const sql = buildCreateFunctionSql({
      name: "f",
      args: "id text; DROP TABLE t",
      returns: "void; SELECT 1",
      language: "plpgsql",
      body: "BEGIN\n  NULL;\nEND;",
    });
    expect(sql).toContain('FUNCTION "f"()');
    expect(sql).toContain("RETURNS void");
    expect(sql).not.toContain("DROP TABLE");
  });
});

describe("extractFunctionBody", () => {
  test("reads the dollar-quoted body", () => {
    expect(extractFunctionBody(DEFAULT_CREATE_FUNCTION_SQL)).toBe(
      "BEGIN\n  -- Write your function logic here\nEND;",
    );
  });
});

describe("isSafeFunctionClause", () => {
  test("allows argument lists", () => {
    expect(isSafeFunctionClause("id text, name text")).toBe(true);
  });

  test("rejects stacking and comments", () => {
    expect(isSafeFunctionClause("id text; SELECT 1")).toBe(false);
    expect(isSafeFunctionClause("id text -- x")).toBe(false);
  });
});
