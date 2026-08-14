import { describe, expect, test } from "bun:test";
import {
  pendingChangePath,
  pendingDiffLines,
  pendingToKv,
  pendingToSql,
  sqlLiteral,
} from "./pending-sql.ts";

describe("sqlLiteral", () => {
  test("quotes strings and doubles apostrophes", () => {
    expect(sqlLiteral("a'b")).toBe("'a''b'");
  });

  test("emits NULL / numbers / booleans", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(12)).toBe("12");
    expect(sqlLiteral(true)).toBe("TRUE");
  });
});

describe("pendingChangePath", () => {
  test("joins table, row, and column", () => {
    expect(pendingChangePath({ table: "bookings", rowId: "bk_8f2a", key: "email" })).toBe(
      "bookings > row bk_8f2a > email",
    );
  });
});

describe("pendingDiffLines", () => {
  test("emits a removed then added line", () => {
    const lines = pendingDiffLines("old", "new");
    expect(lines.map((l) => l.type)).toEqual(["removed", "added"]);
    expect(lines[0]?.content).toBe("old");
    expect(lines[1]?.content).toBe("new");
  });
});

describe("pendingToSql", () => {
  test("groups cells on the same row into one UPDATE", () => {
    const sql = pendingToSql({
      table: "bookings",
      updates: [
        { rowId: "b1", key: "flight_id", prev: "SK-1", next: "SK-2" },
        { rowId: "b1", key: "seats", prev: 1, next: 2 },
      ],
    });
    expect(sql).toContain("-- Update row b1 of bookings");
    expect(sql).toContain(
      'UPDATE "bookings" SET "flight_id" = \'SK-2\', "seats" = 2 WHERE "id" = \'b1\';',
    );
  });

  test("emits one statement per row", () => {
    const sql = pendingToSql({
      table: "bookings",
      updates: [
        { rowId: "a", key: "note", prev: "x", next: "y" },
        { rowId: "b", key: "note", prev: "x", next: "z" },
      ],
    });
    expect(sql).toContain("-- Update note in row a of bookings");
    expect(sql).toContain("-- Update note in row b of bookings");
  });
});

describe("pendingToKv", () => {
  test("emits set(key, value) for a JSON patch", () => {
    const script = pendingToKv({
      updates: [
        {
          rowId: "drafts:DES-203",
          key: "value",
          prev: { identifier: "DES-203" },
          next: { identifier: "DES-203-1" },
        },
      ],
    });
    expect(script).toContain("// Update drafts:DES-203");
    expect(script).toContain('set("drafts:DES-203", {');
    expect(script).toContain('"identifier": "DES-203-1"');
    expect(script).not.toContain("UPDATE");
  });

  test("groups value and TTL on the same key into one set", () => {
    const script = pendingToKv({
      updates: [
        { rowId: "drafts:a", key: "value", prev: { n: 1 }, next: { n: 2 } },
        { rowId: "drafts:a", key: "ttl", prev: 3_600_000, next: "10m" },
      ],
    });
    expect(script).toContain("// Update value and TTL on drafts:a");
    expect(script).toContain('set("drafts:a", {\n  "n": 2\n}, "10m")');
  });

  test("TTL-only keeps the value identifier; empty TTL clears expiry", () => {
    expect(
      pendingToKv({
        updates: [{ rowId: "drafts:a", key: "ttl", prev: 3_600_000, next: "30m" }],
      }),
    ).toBe('// Update TTL on drafts:a\nset("drafts:a", value, "30m")');
    expect(
      pendingToKv({
        updates: [{ rowId: "drafts:a", key: "ttl", prev: 3_600_000, next: null }],
      }),
    ).toBe('// Clear TTL on drafts:a\nset("drafts:a", value)');
  });
});
