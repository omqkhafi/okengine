/**
 * JSON Schema → Call API field seeds.
 */

import { describe, expect, test } from "bun:test";
import {
  fieldConstraintHint,
  fieldRangeSentence,
  fieldsFromSchema,
  fieldsWithValidation,
  integerSelectValues,
  seedFromSchema,
} from "./fields-from-schema.ts";

const LIST_IN = {
  type: "object",
  properties: {
    q: { type: "string", description: "Search title, id, name" },
    teamKey: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
    offset: { type: "integer", minimum: 0, default: 0 },
    cursor: { type: "string" },
    orderBy: { type: "string", default: "id" },
    order: { type: "string", enum: ["asc", "desc"], default: "asc" },
  },
};

describe("fieldsFromSchema", () => {
  test("lists every list query / pagination field", () => {
    const names = fieldsFromSchema(LIST_IN).map((f) => f.name);
    expect(names).toEqual(["q", "teamKey", "limit", "offset", "cursor", "orderBy", "order"]);
    expect(fieldsFromSchema(LIST_IN).find((f) => f.name === "order")?.enumValues).toEqual([
      "asc",
      "desc",
    ]);
  });

  test("marks PK / FK / unique from keywords and field names", () => {
    const fields = fieldsFromSchema({
      type: "object",
      properties: {
        id: { type: "string" },
        identifier: { type: "string" },
        teamKey: { type: "string" },
        userId: { type: "string" },
        title: { type: "string" },
        email: { type: "string", pii: true },
        token: { type: "string", sensitive: true },
        airportId: {
          type: "string",
          references: { table: "airports", column: "id" },
        },
      },
    });
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.id).toMatchObject({ primaryKey: true });
    expect(byName.identifier).toMatchObject({ unique: true });
    expect(byName.teamKey).toMatchObject({ foreignKey: true });
    expect(byName.userId).toMatchObject({ foreignKey: true });
    expect(byName.title?.primaryKey).toBeUndefined();
    expect(byName.email).toMatchObject({ pii: true });
    expect(byName.token).toMatchObject({ sensitive: true });
    expect(byName.airportId).toMatchObject({
      foreignKey: true,
      references: { table: "airports", column: "id" },
    });
  });
});

describe("field constraints", () => {
  test("expands a small integer range into options", () => {
    const priority = fieldsFromSchema({
      type: "object",
      properties: {
        priority: {
          type: "integer",
          minimum: 0,
          maximum: 4,
          oneOf: [
            { const: 0, title: "No priority" },
            { const: 1, title: "Urgent" },
            { const: 2, title: "High" },
            { const: 3, title: "Medium" },
            { const: 4, title: "Low" },
          ],
        },
      },
    })[0]!;
    expect(fieldConstraintHint(priority)).toBe("0–4");
    expect(fieldRangeSentence(priority)).toBe("Must be from 0 up to 4.");
    expect(integerSelectValues(priority)).toEqual([0, 1, 2, 3, 4]);
    expect(priority.valueMeanings?.map((m) => m.label)).toEqual([
      "No priority",
      "Urgent",
      "High",
      "Medium",
      "Low",
    ]);
    expect(fieldsWithValidation([priority]).map((f) => f.name)).toEqual(["priority"]);
  });

  test("keeps a wide range as a hint only", () => {
    const limit = fieldsFromSchema(LIST_IN).find((f) => f.name === "limit")!;
    expect(fieldConstraintHint(limit)).toBe("1–100");
    expect(integerSelectValues(limit)).toBeNull();
  });
});

describe("seedFromSchema", () => {
  test("prefers default over minimum so list limit seeds 25", () => {
    const seeded = seedFromSchema(LIST_IN) as Record<string, unknown>;
    expect(seeded.limit).toBe(25);
    expect(seeded.offset).toBe(0);
    expect(seeded.orderBy).toBe("id");
    expect(seeded.order).toBe("asc");
    expect(seeded.q).toBeUndefined();
    expect(seeded.cursor).toBeUndefined();
  });
});
