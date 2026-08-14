import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../../../../../manifest/types.ts";
import type { StoreListStore } from "@/client.ts";
import { fieldsFromKvValues, querySchemaTables } from "./query-schema.ts";

const emptyWillNot = { writerFlowIds: [], signals: [], channels: [] };
const emptyCache = {
  producedByRead: "cache:sql:db",
  invalidatedByWrites: [] as string[],
  invalidatingFlowIds: [] as string[],
};

const STORE: StoreListStore = {
  ref: "sql:db",
  facet: "sql",
  name: "db",
  children: [
    {
      name: "comments",
      effectRef: "sql:comments",
      writers: [],
      readers: [],
      cache: emptyCache,
      willNotFire: emptyWillNot,
      piiColumns: ["author_email"],
      columnDescriptions: { body: "Markdown" },
    },
    {
      name: "indexes",
      effectRef: "sql:db/indexes",
      kind: "index",
      writers: [],
      readers: [],
      cache: emptyCache,
      willNotFire: emptyWillNot,
      piiColumns: [],
      columnDescriptions: {},
    },
  ],
  replicaLagMs: null,
  migrationDrift: null,
  contentAddressed: false,
  warnings: [],
};

const MANIFEST = {
  oke: "1.0",
  app: "t",
  stores: {
    db: {
      facet: "sql",
      tables: {
        comments: {
          columns: {
            id: { type: "text", primaryKey: true },
            author_email: { type: "text", pii: true },
            body: { type: "text" },
          },
        },
      },
    },
  },
} as Manifest;

describe("querySchemaTables", () => {
  test("prefers Manifest columns and keeps PII / PK", () => {
    const tables = querySchemaTables(STORE, MANIFEST);
    expect(tables).toHaveLength(1);
    expect(tables[0]?.name).toBe("comments");
    expect(tables[0]?.columns.map((c) => c.name)).toEqual(["id", "author_email", "body"]);
    expect(tables[0]?.columns.find((c) => c.name === "id")?.primaryKey).toBe(true);
    expect(tables[0]?.columns.find((c) => c.name === "author_email")?.pii).toBe(true);
  });

  test("overlays inferred FK from schema graph", () => {
    const store: StoreListStore = {
      ...STORE,
      children: [
        ...STORE.children,
        {
          name: "issues",
          effectRef: "sql:issues",
          writers: [],
          readers: [],
          cache: emptyCache,
          willNotFire: emptyWillNot,
          piiColumns: [],
          columnDescriptions: {},
        },
      ],
    };
    const manifest = {
      ...MANIFEST,
      stores: {
        db: {
          facet: "sql",
          tables: {
            issues: { columns: { id: { type: "text", primaryKey: true } } },
            comments: {
              columns: {
                id: { type: "text", primaryKey: true },
                issue_id: { type: "text" },
                author_email: { type: "text", pii: true },
                body: { type: "text" },
              },
            },
          },
        },
      },
    } as Manifest;
    const comments = querySchemaTables(store, manifest).find((t) => t.name === "comments");
    expect(comments?.columns.find((c) => c.name === "issue_id")?.references).toEqual({
      table: "issues",
      column: "id",
    });
    expect(comments?.columns.find((c) => c.name === "issue_id")?.inferredRef).toBe(true);
  });

  test("fieldsFromKvValues unions object keys and types", () => {
    expect(
      fieldsFromKvValues([
        { identifier: "ENG-184", title: "Pulse", expiresAt: "2026-08-14T01:00:00Z" },
        { identifier: "SUP-12", until: "2026-08-15T12:00:00Z", reason: "waiting" },
        "skip",
      ]),
    ).toEqual([
      { name: "identifier", type: "string" },
      { name: "title", type: "string" },
      { name: "expiresAt", type: "string" },
      { name: "until", type: "string" },
      { name: "reason", type: "string" },
    ]);
  });

  test("falls back to list projection when Manifest has no table", () => {
    const tables = querySchemaTables(STORE, { oke: "1.0", app: "t" } as Manifest);
    expect(tables[0]?.columns.map((c) => c.name).sort()).toEqual(["author_email", "body"]);
  });
});
