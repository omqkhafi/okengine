import { describe, expect, test } from "bun:test";
import { field, store } from "../elements/store.ts";
import { schemaTableName, sqlTableRef } from "./sql-resource.ts";

describe("schemaTableName", () => {
  test("reads the declared name when no column is called name", () => {
    const issues = store.schema.table("issues", {
      id: field.text().primaryKey(),
      title: field.text().notNull(),
    });
    expect(schemaTableName(issues)).toBe("issues");
    expect(sqlTableRef(schemaTableName(issues)!)).toBe("sql:issues");
  });

  test("survives a column named name (teams / labels / cycles)", () => {
    const teams = store.schema.table("teams", {
      id: field.text().primaryKey(),
      name: field.text().notNull(),
    });
    expect(typeof teams.name).toBe("object");
    expect(schemaTableName(teams)).toBe("teams");
    expect(sqlTableRef(schemaTableName(teams)!)).toBe("sql:teams");
  });

  test("ignores non schema-table values", () => {
    expect(schemaTableName({ name: "teams" })).toBeUndefined();
    expect(schemaTableName(null)).toBeUndefined();
  });
});
