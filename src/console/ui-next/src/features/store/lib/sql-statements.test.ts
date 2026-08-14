import { describe, expect, test } from "bun:test";
import {
  isSqlWrite,
  isUnboundedSelect,
  lineAtOffset,
  splitSqlStatements,
  sqlBatchToRun,
  sqlToRun,
  statementAtCursor,
  wrapExplain,
} from "./sql-statements.ts";

describe("splitSqlStatements", () => {
  test("splits on semicolons outside strings", () => {
    const stmts = splitSqlStatements(`SELECT 1; SELECT ';' FROM t;`);
    expect(stmts.map((s) => s.text)).toEqual(["SELECT 1;", "SELECT ';' FROM t;"]);
    expect(stmts[0]?.startLine).toBe(1);
    expect(stmts[1]?.startLine).toBe(1);
  });

  test("keeps a trailing statement without a semicolon", () => {
    const stmts = splitSqlStatements("SELECT 1;\nSELECT 2");
    expect(stmts.map((s) => s.text)).toEqual(["SELECT 1;", "SELECT 2"]);
    expect(stmts[1]?.startLine).toBe(2);
  });

  test("ignores empty chunks", () => {
    expect(splitSqlStatements("   ;\n\n")).toEqual([]);
  });
});

describe("sqlToRun", () => {
  const sql = "SELECT 1;\nSELECT 2;";

  test("uses a non-empty selection", () => {
    expect(sqlToRun(sql, 0, 9)).toBe("SELECT 1;");
  });

  test("uses the statement at the caret", () => {
    expect(sqlToRun(sql, 12, 12)).toBe("SELECT 2;");
  });
});

describe("statementAtCursor", () => {
  test("returns the last statement when the caret is past the end", () => {
    const sql = "SELECT 1;";
    expect(statementAtCursor(sql, 99)?.text).toBe("SELECT 1;");
  });
});

describe("sqlBatchToRun", () => {
  const sql = "SELECT 1;\nINSERT INTO t VALUES (1);\nSELECT 2;";

  test("current uses the caret statement", () => {
    expect(sqlBatchToRun(sql, 0, 0, "current")).toEqual(["SELECT 1;"]);
  });

  test("selection splits into statements", () => {
    expect(sqlBatchToRun(sql, 0, sql.length, "current")).toEqual([
      "SELECT 1;",
      "INSERT INTO t VALUES (1);",
      "SELECT 2;",
    ]);
  });

  test("all returns every statement", () => {
    expect(sqlBatchToRun(sql, 0, 0, "all")).toEqual([
      "SELECT 1;",
      "INSERT INTO t VALUES (1);",
      "SELECT 2;",
    ]);
  });
});

describe("wrapExplain", () => {
  test("prefixes EXPLAIN and skips a second wrap", () => {
    expect(wrapExplain("SELECT 1;", false)).toBe("EXPLAIN SELECT 1");
    expect(wrapExplain("SELECT 1", true)).toBe("EXPLAIN ANALYZE SELECT 1");
    expect(wrapExplain("EXPLAIN SELECT 1", false)).toBe("EXPLAIN SELECT 1");
  });
});

describe("isSqlWrite", () => {
  test("flags DML and DDL heads", () => {
    expect(isSqlWrite("INSERT INTO t VALUES (1)")).toBe(true);
    expect(isSqlWrite("UPDATE t SET n = 1")).toBe(true);
    expect(isSqlWrite("DELETE FROM t WHERE id = 'a'")).toBe(true);
    expect(isSqlWrite("CREATE TABLE t (id text)")).toBe(true);
    expect(isSqlWrite("DROP TABLE t")).toBe(true);
    expect(isSqlWrite("SELECT * FROM t")).toBe(false);
    expect(isSqlWrite("EXPLAIN SELECT 1")).toBe(false);
    expect(isSqlWrite("EXPLAIN ANALYZE SELECT 1")).toBe(true);
    expect(isSqlWrite("GRANT SELECT ON t TO public")).toBe(true);
    expect(isSqlWrite("ANALYZE t")).toBe(true);
  });
});

describe("isUnboundedSelect", () => {
  test("flags SELECT / WITH without LIMIT", () => {
    expect(isUnboundedSelect("SELECT * FROM t")).toBe(true);
    expect(isUnboundedSelect("with x as (select 1) select * from x")).toBe(true);
    expect(isUnboundedSelect("SELECT * FROM t LIMIT 10")).toBe(false);
    expect(isUnboundedSelect("SELECT 'limit' FROM t")).toBe(true);
    expect(isUnboundedSelect("INSERT INTO t VALUES (1)")).toBe(false);
  });
});

describe("lineAtOffset", () => {
  test("counts newlines", () => {
    expect(lineAtOffset("a\nb\nc", 0)).toBe(1);
    expect(lineAtOffset("a\nb\nc", 2)).toBe(2);
    expect(lineAtOffset("a\nb\nc", 4)).toBe(3);
  });
});
