/**
 * Parameter vs field split for the contract pane.
 */

import { describe, expect, test } from "bun:test";
import { pickSeedFields, splitCallApiInput, splitContractInput } from "./contract-input.ts";
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

describe("splitCallApiInput", () => {
  const idOnly = fieldsFromSchema({
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", minLength: 1 } },
  });
  const list = LIST_IN;
  const nestedList = fieldsFromSchema({
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", minLength: 1 },
      q: { type: "string" },
      limit: { type: "integer" },
    },
  });
  const create = fieldsFromSchema({
    type: "object",
    required: ["title"],
    properties: { title: { type: "string" }, spaceKey: { type: "string" } },
  });
  const assign = fieldsFromSchema({
    type: "object",
    required: ["id", "assigneeEmail"],
    properties: { id: { type: "string" }, assigneeEmail: { type: "string" } },
  });
  const patch = fieldsFromSchema({
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      status: { type: "string" },
    },
  });
  const putDraft = fieldsFromSchema({
    type: "object",
    required: ["id", "title"],
    properties: { id: { type: "string" }, title: { type: "string" }, body: { type: "string" } },
  });
  const search = fieldsFromSchema({
    type: "object",
    required: ["q"],
    properties: { q: { type: "string" }, limit: { type: "integer" } },
  });

  const cases: readonly {
    readonly name: string;
    readonly method: string;
    readonly pathParams: readonly string[];
    readonly fields: ReturnType<typeof fieldsFromSchema>;
    readonly path: readonly string[];
    readonly query: readonly string[];
    readonly body: readonly string[];
  }[] = [
    {
      name: "GET tasks.get",
      method: "GET",
      pathParams: ["id"],
      fields: idOnly,
      path: ["id"],
      query: [],
      body: [],
    },
    {
      name: "GET tasks.list",
      method: "GET",
      pathParams: [],
      fields: list,
      path: [],
      query: ["q", "teamKey", "limit", "offset", "cursor", "orderBy", "order"],
      body: [],
    },
    {
      name: "GET comments.list /tasks/:id/comments",
      method: "GET",
      pathParams: ["id"],
      fields: nestedList,
      path: ["id"],
      query: ["q", "limit"],
      body: [],
    },
    {
      name: "HEAD main.health",
      method: "HEAD",
      pathParams: [],
      fields: [],
      path: [],
      query: [],
      body: [],
    },
    {
      name: "DELETE tasks.delete",
      method: "DELETE",
      pathParams: ["id"],
      fields: idOnly,
      path: ["id"],
      query: [],
      body: [],
    },
    {
      name: "POST tasks.create",
      method: "POST",
      pathParams: [],
      fields: create,
      path: [],
      query: [],
      body: ["title", "spaceKey"],
    },
    {
      name: "POST tasks.assign /tasks/:id/assign",
      method: "POST",
      pathParams: ["id"],
      fields: assign,
      path: ["id"],
      query: [],
      body: ["assigneeEmail"],
    },
    {
      name: "POST tasks.archive path-only",
      method: "POST",
      pathParams: ["id"],
      fields: idOnly,
      path: ["id"],
      query: [],
      body: [],
    },
    {
      name: "PATCH tasks.update",
      method: "PATCH",
      pathParams: ["id"],
      fields: patch,
      path: ["id"],
      query: [],
      body: ["title", "status"],
    },
    {
      name: "PUT drafts.save",
      method: "PUT",
      pathParams: ["id"],
      fields: putDraft,
      path: ["id"],
      query: [],
      body: ["title", "body"],
    },
    {
      name: "QUERY search.query",
      method: "QUERY",
      pathParams: [],
      fields: search,
      path: [],
      query: [],
      body: ["q", "limit"],
    },
    {
      name: "OPTIONS leftover stays body",
      method: "OPTIONS",
      pathParams: [],
      fields: search,
      path: [],
      query: [],
      body: ["q", "limit"],
    },
  ];

  for (const row of cases) {
    test(row.name, () => {
      const split = splitCallApiInput(row.fields, {
        http: true,
        method: row.method,
        pathParams: row.pathParams,
      });
      expect(split.path).toEqual([...row.path]);
      expect(split.query.map((f) => f.name)).toEqual([...row.query]);
      expect(split.body.map((f) => f.name)).toEqual([...row.body]);
    });
  }

  test("non-HTTP keeps the full input as body", () => {
    const split = splitCallApiInput(idOnly);
    expect(split.path).toEqual([]);
    expect(split.query).toEqual([]);
    expect(split.body.map((f) => f.name)).toEqual(["id"]);
  });

  test("Signal / CDC / Call-only never grow Path params from an id field", () => {
    for (const kind of ["signal", "cdc", "internal"] as const) {
      const split = splitCallApiInput(idOnly, { http: false, method: kind });
      expect(split.path).toEqual([]);
      expect(split.query).toEqual([]);
      expect(split.body.map((f) => f.name)).toEqual(["id"]);
    }
  });
});

describe("pickSeedFields", () => {
  test("keeps only named section keys", () => {
    const title = fieldsFromSchema({
      type: "object",
      properties: { title: { type: "string" } },
    });
    expect(pickSeedFields({ id: "x", title: "n" }, title)).toEqual({ title: "n" });
  });
});
