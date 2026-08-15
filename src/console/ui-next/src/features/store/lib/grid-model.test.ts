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

  test("pii flag attaches when row keys and piiColumns use opposite spellings", () => {
    const fromJs = buildStoreGridModel({
      facet: "sql",
      data: {
        facet: "sql",
        rows: [{ id: "v1", owner_email: "[redacted]" }],
        masked: true,
      },
      piiColumns: ["ownerEmail"],
    });
    expect(fromJs.columns.find((c) => c.key === "owner_email")?.pii).toBe(true);

    const fromSql = buildStoreGridModel({
      facet: "sql",
      data: {
        facet: "sql",
        rows: [{ id: "v1", ownerEmail: "[redacted]" }],
        masked: true,
      },
      piiColumns: ["owner_email"],
    });
    expect(fromSql.columns.find((c) => c.key === "ownerEmail")?.pii).toBe(true);
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
    expect(model.columns.map((c) => c.key)).toEqual(["key", "value", "ttl", "size"]);
    expect(model.columns.find((c) => c.key === "value")?.editable).toBe(true);
    expect(model.columns.find((c) => c.key === "ttl")?.editable).toBe(true);
    expect(model.rows[0]?.cells.value).toEqual({ seats: 2 });
    expect(model.rows[0]?.cells.ttl).toBeNull();
    expect(typeof model.rows[0]?.cells.size).toBe("number");
  });

  test("files and index are read-only with correct delete kind", () => {
    const files = buildStoreGridModel({
      facet: "files",
      data: { facet: "files", keys: [{ key: "a.pdf" }], masked: false },
    });
    expect(files.editable).toBe(false);
    expect(files.deleteKind).toBe("keys");
    expect(files.columns.map((c) => c.key)).toEqual(["key", "size", "warnings"]);

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
    expect(index.columns.map((c) => c.key)).toEqual(["id", "t", "score"]);
    expect(index.rows[0]?.cells.t).toBe(1);
  });

  test("index hits promote title / identifier and drop vector-shaped meta", () => {
    const index = buildStoreGridModel({
      facet: "index",
      data: {
        facet: "index",
        hits: [
          {
            id: "tsk_eng_12",
            score: 0,
            meta: { identifier: "ENG-12", title: "SSO login fails", "0": 1, "1": 0 },
          },
        ],
        masked: false,
      },
    });
    expect(index.columns.map((c) => c.key)).toEqual(["id", "identifier", "title", "score"]);
    expect(index.rows[0]?.cells).toEqual({
      id: "tsk_eng_12",
      identifier: "ENG-12",
      title: "SSO login fails",
      score: 0,
    });
  });
});

describe("sqlRowId", () => {
  test("prefers id then Id, stringifies primitives", () => {
    expect(sqlRowId({ id: "b1" })).toBe("b1");
    expect(sqlRowId({ Id: 42 })).toBe("42");
    expect(sqlRowId({ name: "vector" })).toBe("vector");
    expect(sqlRowId({})).toBe("");
  });
});
