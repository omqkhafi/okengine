import { describe, expect, test } from "bun:test";
import { buildStoreGridModel, sqlRowId } from "./grid-model.ts";

describe("buildStoreGridModel", () => {
  test("sql rows map to editable typed columns with pii flags", () => {
    const model = buildStoreGridModel({
      facet: "sql",
      data: {
        facet: "sql",
        rows: [
          { id: "b1", email: "[redacted]", seats: 2 },
          { id: "b2", email: "[redacted]", seats: 1 },
        ],
        masked: true,
      },
      piiColumns: ["email"],
      columnTypes: { id: "text", email: "text", seats: "integer" },
      primaryKeyColumns: ["id"],
    });
    expect(model.editable).toBe(true);
    expect(model.deleteKind).toBe("ids");
    expect(model.columns.map((c) => c.key)).toEqual(["id", "email", "seats"]);
    expect(model.columns.find((c) => c.key === "email")?.pii).toBe(true);
    expect(model.columns.find((c) => c.key === "seats")?.type).toBe("integer");
    expect(model.columns.find((c) => c.key === "id")?.editable).toBe(false);
    expect(model.columns.find((c) => c.key === "id")?.primaryKey).toBe(true);
    expect(model.rows[0]?.id).toBe("b1");
  });

  test("kv keys map to key + editable json value", () => {
    const model = buildStoreGridModel({
      facet: "kv",
      data: {
        facet: "kv",
        keys: [{ key: "hold:1", value: { seats: 2 } }],
        masked: false,
      },
    });
    expect(model.columns.map((c) => c.key)).toEqual(["key", "value"]);
    expect(model.columns.find((c) => c.key === "value")?.editable).toBe(true);
    expect(model.rows[0]?.cells.value).toEqual({ seats: 2 });
  });

  test("files and index are read-only with correct delete kind", () => {
    const files = buildStoreGridModel({
      facet: "files",
      data: { facet: "files", keys: [{ key: "a.pdf" }], masked: false },
    });
    expect(files.editable).toBe(false);
    expect(files.deleteKind).toBe("keys");

    const index = buildStoreGridModel({
      facet: "index",
      data: {
        facet: "index",
        hits: [{ id: "d1", score: 0.9, meta: { t: 1 } }],
        masked: false,
      },
    });
    expect(index.editable).toBe(false);
    expect(index.deleteKind).toBe("ids");
    expect(index.rows[0]?.cells.score).toBe(0.9);
  });
});

describe("sqlRowId", () => {
  test("prefers id then Id, stringifies primitives", () => {
    expect(sqlRowId({ id: "b1" })).toBe("b1");
    expect(sqlRowId({ Id: 42 })).toBe("42");
    expect(sqlRowId({})).toBe("");
  });
});
