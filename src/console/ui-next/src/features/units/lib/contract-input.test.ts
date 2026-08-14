/**
 * Parameter vs field split for the contract pane.
 */

import { describe, expect, test } from "bun:test";
import { splitContractInput } from "./contract-input.ts";
import { fieldsFromSchema } from "./fields-from-schema.ts";

const LIST_IN = fieldsFromSchema({
  type: "object",
  properties: {
    q: { type: "string" },
    teamKey: { type: "string" },
    limit: { type: "integer" },
    offset: { type: "integer" },
    cursor: { type: "string" },
    orderBy: { type: "string" },
    order: { type: "string", enum: ["asc", "desc"] },
  },
});

describe("splitContractInput", () => {
  test("keeps list controls as parameters and teamKey as a field", () => {
    const split = splitContractInput(LIST_IN);
    expect(split.parameters.map((f) => f.name)).toEqual([
      "q",
      "limit",
      "offset",
      "cursor",
      "orderBy",
      "order",
    ]);
    expect(split.fields.map((f) => f.name)).toEqual(["teamKey"]);
  });

  test("treats path tokens as parameters", () => {
    const split = splitContractInput(
      fieldsFromSchema({
        type: "object",
        properties: { title: { type: "string" } },
      }),
      ["id"],
    );
    expect(split.parameters.map((f) => f.name)).toEqual(["id"]);
    expect(split.fields.map((f) => f.name)).toEqual(["title"]);
  });
});
