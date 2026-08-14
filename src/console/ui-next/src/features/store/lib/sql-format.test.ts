import { describe, expect, test } from "bun:test";
import { prettifySql, splitSqlPreservingStrings } from "./sql-format.ts";

describe("prettifySql", () => {
  test("breaks major clauses and uppercases keywords", () => {
    expect(prettifySql('select * from "bookings" where id = 1 limit 10')).toBe(
      'SELECT *\nFROM "bookings"\nWHERE id = 1\nLIMIT 10',
    );
  });

  test("does not break keywords inside strings", () => {
    expect(prettifySql("select 'from where' from t")).toBe("SELECT 'from where'\nFROM t");
  });

  test("indents AND / OR", () => {
    expect(prettifySql("select 1 from t where a = 1 and b = 2")).toBe(
      "SELECT 1\nFROM t\nWHERE a = 1\n  AND b = 2",
    );
  });

  test("returns empty for blank input", () => {
    expect(prettifySql("   \n")).toBe("");
  });
});

describe("splitSqlPreservingStrings", () => {
  test("keeps doubled quotes inside a string", () => {
    const parts = splitSqlPreservingStrings("x 'it''s' y");
    expect(parts).toEqual([
      { quoted: false, text: "x " },
      { quoted: true, text: "'it''s'" },
      { quoted: false, text: " y" },
    ]);
  });
});
