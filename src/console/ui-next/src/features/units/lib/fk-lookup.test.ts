/**
 * FK field → Store table lookup.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../../../../../manifest/types.ts";
import { fieldsFromSchema } from "./fields-from-schema.ts";
import { fkOptionsFromRows, resolveFkLookup } from "./fk-lookup.ts";

const MANIFEST = {
  oke: "1.0",
  app: "keel",
  stores: {
    db: {
      facet: "sql",
      tables: {
        teams: {
          columns: {
            id: { type: "text", primaryKey: true },
            key: { type: "text" },
            name: { type: "text" },
          },
        },
        users: {
          columns: {
            id: { type: "text", primaryKey: true },
            name: { type: "text" },
          },
        },
      },
    },
  },
} as Manifest;

describe("resolveFkLookup", () => {
  test("maps teamKey onto teams.key", () => {
    const field = fieldsFromSchema({
      type: "object",
      properties: { teamKey: { type: "string" } },
    })[0];
    expect(field).toBeDefined();
    expect(resolveFkLookup(field!, MANIFEST)).toEqual({
      ref: "sql:db",
      child: "teams",
      column: "key",
      labelColumn: "name",
    });
  });

  test("maps userId onto users.id", () => {
    const field = fieldsFromSchema({
      type: "object",
      properties: { userId: { type: "string" } },
    })[0];
    expect(resolveFkLookup(field!, MANIFEST)).toEqual({
      ref: "sql:db",
      child: "users",
      column: "id",
      labelColumn: "name",
    });
  });

  test("honors declared references", () => {
    const field = fieldsFromSchema({
      type: "object",
      properties: {
        airportId: { type: "string", references: { table: "users", column: "id" } },
      },
    })[0];
    expect(resolveFkLookup(field!, MANIFEST)).toEqual({
      ref: "sql:db",
      child: "users",
      column: "id",
      labelColumn: "name",
    });
  });

  test("returns null when the table is missing", () => {
    const field = fieldsFromSchema({
      type: "object",
      properties: { projectId: { type: "string" } },
    })[0];
    expect(resolveFkLookup(field!, MANIFEST)).toBeNull();
  });
});

describe("fkOptionsFromRows", () => {
  test("uses key + name and skips duplicates", () => {
    expect(
      fkOptionsFromRows(
        [
          { key: "ENG", name: "Engineering" },
          { key: "ENG", name: "Engineering" },
          { key: "DES", name: "Design" },
        ],
        { ref: "sql:db", child: "teams", column: "key", labelColumn: "name" },
      ),
    ).toEqual([
      { value: "ENG", label: "ENG · Engineering" },
      { value: "DES", label: "DES · Design" },
    ]);
  });
});
