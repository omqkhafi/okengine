import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../../../../../manifest/types.ts";
import type { StoreListStore } from "@/client.ts";
import {
  buildSchemaGraph,
  emphasizeSchemaEdges,
  emphasizeSchemaNodes,
  schemaGraphTables,
  schemaGraphToSql,
  schemaNeighborIds,
  schemaNodeHeight,
  schemaRelationKind,
  schemaRelationLabel,
} from "./schema-graph.ts";

const emptyWillNot = { writerFlowIds: [], signals: [], channels: [] };
const emptyCache = {
  producedByRead: "cache:sql:db",
  invalidatedByWrites: [] as string[],
  invalidatingFlowIds: [] as string[],
};

const STORES: readonly StoreListStore[] = [
  {
    ref: "sql:db",
    facet: "sql",
    name: "db",
    children: [
      {
        name: "airports",
        effectRef: "sql:airports",
        writers: [],
        readers: [],
        cache: emptyCache,
        willNotFire: emptyWillNot,
        piiColumns: [],
        columnDescriptions: {},
      },
      {
        name: "flights",
        effectRef: "sql:flights",
        writers: [],
        readers: [],
        cache: emptyCache,
        willNotFire: emptyWillNot,
        piiColumns: ["passenger_email"],
        columnDescriptions: {},
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
  },
  {
    ref: "kv:cache",
    facet: "kv",
    name: "cache",
    children: [
      {
        name: "holds",
        effectRef: "kv:cache",
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
  },
];

const MANIFEST = {
  oke: "1.0",
  app: "t",
  stores: {
    db: {
      facet: "sql",
      tables: {
        airports: {
          columns: {
            id: { type: "text", primaryKey: true },
            icao: { type: "text", unique: true, nullable: false },
            name: { type: "text", nullable: false },
          },
        },
        flights: {
          columns: {
            id: { type: "text", primaryKey: true },
            airport_id: {
              type: "text",
              nullable: false,
              references: { table: "airports", column: "id" },
            },
            passenger_email: { type: "text", pii: true },
          },
        },
      },
    },
  },
} as Manifest;

describe("schemaGraphTables", () => {
  test("keeps SQL tables and drops catalog / other facets", () => {
    const tables = schemaGraphTables(STORES, MANIFEST);
    expect(tables.map((t) => t.name)).toEqual(["airports", "flights"]);
    expect(tables[0]?.columns.find((c) => c.name === "id")?.primaryKey).toBe(true);
    expect(tables[1]?.columns.find((c) => c.name === "passenger_email")?.pii).toBe(true);
    expect(tables[1]?.columns.find((c) => c.name === "airport_id")?.references).toEqual({
      table: "airports",
      column: "id",
    });
    expect(tables[1]?.columns.find((c) => c.name === "airport_id")?.inferredRef).toBeUndefined();
  });
});

describe("buildSchemaGraph", () => {
  test("lays out FK edges between declared references", () => {
    const tables = schemaGraphTables(STORES, MANIFEST);
    const graph = buildSchemaGraph(tables);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.source).toBe("sql:flights");
    expect(graph.edges[0]?.target).toBe("sql:airports");
    expect(graph.edges[0]?.sourceHandle).toBe("out:airport_id");
    expect(graph.edges[0]?.targetHandle).toBe("in:id");
    expect(graph.edges[0]?.data?.relation).toBe("many-to-one");
    expect(graph.edges[0]?.data?.column).toBe("airport_id");
    expect(graph.edges[0]?.type).toBe("relation");
    expect(graph.edges[0]?.label).toBeUndefined();
    expect(schemaNodeHeight(3)).toBeGreaterThan(schemaNodeHeight(1));
  });

  test("emphasizeSchemaNodes dims non-matching search hits", () => {
    const graph = buildSchemaGraph(schemaGraphTables(STORES, MANIFEST));
    const next = emphasizeSchemaNodes(graph.nodes, "flight", "sql:flights", graph.edges);
    expect(next.find((n) => n.id === "sql:flights")?.data.selected).toBe(true);
    expect(next.find((n) => n.id === "sql:flights")?.data.dimmed).toBe(false);
    expect(next.find((n) => n.id === "sql:airports")?.data.dimmed).toBe(true);
  });

  test("selecting a related table dims outsiders and unrelated edges", () => {
    const graph = buildSchemaGraph(schemaGraphTables(STORES, MANIFEST));
    expect(schemaNeighborIds(graph.edges, "sql:flights")).toEqual(
      new Set(["sql:flights", "sql:airports"]),
    );
    const nodes = emphasizeSchemaNodes(graph.nodes, "", "sql:flights", graph.edges);
    expect(nodes.find((n) => n.id === "sql:airports")?.data.dimmed).toBe(false);
    const edges = emphasizeSchemaEdges(graph.edges, "sql:flights");
    expect(edges[0]?.style?.opacity).toBe(1);
  });
});

describe("inferred *_id relations", () => {
  const seed = seedStores([
    "teams",
    "workflow_states",
    "project_milestones",
    "cycles",
    "issues",
    "comments",
    "documents",
  ]);
  const manifest = seedManifest({
    teams: ["id", "parent_id", "name"],
    workflow_states: ["id", "team_id", "name"],
    project_milestones: ["id", "project_id", "name"],
    cycles: ["id", "team_id", "name"],
    issues: ["id", "team_id", "state_id", "milestone_id", "parent_id", "title"],
    comments: ["id", "issue_id", "body"],
    documents: ["id", "parent_kind", "parent_id", "title"],
  });

  test("infers conventional FKs and suffix tables", () => {
    const tables = schemaGraphTables(seed, manifest);
    const comments = tables.find((t) => t.name === "comments");
    const cycles = tables.find((t) => t.name === "cycles");
    const issues = tables.find((t) => t.name === "issues");
    const documents = tables.find((t) => t.name === "documents");
    const teams = tables.find((t) => t.name === "teams");
    expect(comments?.columns.find((c) => c.name === "issue_id")).toMatchObject({
      references: { table: "issues", column: "id" },
      inferredRef: true,
    });
    expect(cycles?.columns.find((c) => c.name === "team_id")).toMatchObject({
      references: { table: "teams", column: "id" },
      inferredRef: true,
    });
    expect(issues?.columns.find((c) => c.name === "state_id")?.references).toEqual({
      table: "workflow_states",
      column: "id",
    });
    expect(issues?.columns.find((c) => c.name === "milestone_id")?.references).toEqual({
      table: "project_milestones",
      column: "id",
    });
    expect(issues?.columns.find((c) => c.name === "parent_id")?.references).toEqual({
      table: "issues",
      column: "id",
    });
    expect(teams?.columns.find((c) => c.name === "parent_id")?.references).toEqual({
      table: "teams",
      column: "id",
    });
    expect(documents?.columns.find((c) => c.name === "parent_id")?.references).toBeUndefined();
  });

  test("draws inferred edges including self parent_id", () => {
    const graph = buildSchemaGraph(schemaGraphTables(seed, manifest));
    const ids = graph.edges.map((e) => e.id).sort();
    expect(ids).toContain("sql:comments.issue_id->sql:issues.id");
    expect(ids).toContain("sql:cycles.team_id->sql:teams.id");
    expect(ids).toContain("sql:issues.state_id->sql:workflow_states.id");
    expect(ids).toContain("sql:issues.parent_id->sql:issues.id");
    expect(graph.edges.find((e) => e.id.includes("comments.issue_id"))?.data?.inferred).toBe(true);
    expect(graph.edges.find((e) => e.id.includes("comments.issue_id"))?.data?.relation).toBe(
      "many-to-one",
    );
    expect(graph.edges.find((e) => e.id.includes("issues.parent_id"))?.data?.relation).toBe("self");
    expect(graph.edges.find((e) => e.id.includes("issues.parent_id"))?.data?.column).toBe(
      "parent_id",
    );
  });

  test("focusing issues dims unrelated tables and their edges", () => {
    const graph = buildSchemaGraph(schemaGraphTables(seed, manifest));
    const neighbors = schemaNeighborIds(graph.edges, "sql:issues");
    expect(neighbors?.has("sql:comments")).toBe(true);
    expect(neighbors?.has("sql:documents")).toBe(false);
    const nodes = emphasizeSchemaNodes(graph.nodes, "", "sql:issues", graph.edges);
    expect(nodes.find((n) => n.id === "sql:comments")?.data.dimmed).toBe(false);
    expect(nodes.find((n) => n.id === "sql:documents")?.data.dimmed).toBe(true);
    expect(nodes.find((n) => n.id === "sql:cycles")?.data.dimmed).toBe(true);
    const edges = emphasizeSchemaEdges(graph.edges, "sql:issues");
    const commentEdge = edges.find((e) => e.id.includes("comments.issue_id"));
    const cycleEdge = edges.find((e) => e.id.includes("cycles.team_id"));
    expect(commentEdge?.style?.opacity).toBe(1);
    expect(commentEdge?.animated).toBe(true);
    expect(cycleEdge?.style?.opacity).toBe(0.14);
    expect(cycleEdge?.animated).toBe(false);
    const all = emphasizeSchemaNodes(graph.nodes, "", "sql:issues", graph.edges, false);
    expect(all.every((n) => n.data.dimmed !== true)).toBe(true);
  });

  test("Copy as SQL omits inferred REFERENCES", () => {
    const sql = schemaGraphToSql(schemaGraphTables(seed, manifest));
    expect(sql).toContain("issue_id text");
    expect(sql).not.toContain("REFERENCES issues");
  });
});

function seedStores(names: readonly string[]): readonly StoreListStore[] {
  return [
    {
      ...STORES[0]!,
      children: names.map((name) => ({
        name,
        effectRef: `sql:${name}`,
        writers: [],
        readers: [],
        cache: emptyCache,
        willNotFire: emptyWillNot,
        piiColumns: [],
        columnDescriptions: {},
      })),
    },
  ];
}

function seedManifest(tables: Readonly<Record<string, readonly string[]>>): Manifest {
  return {
    oke: "1.0",
    app: "t",
    stores: {
      db: {
        facet: "sql",
        tables: Object.fromEntries(
          Object.entries(tables).map(([name, cols]) => [
            name,
            {
              columns: Object.fromEntries(
                cols.map((col) => [
                  col,
                  col === "id" ? { type: "text", primaryKey: true } : { type: "text" },
                ]),
              ),
            },
          ]),
        ),
      },
    },
  } as Manifest;
}

describe("schemaRelationKind", () => {
  test("classifies 1:1, N:N junction, and N:1", () => {
    const users = {
      id: "sql:users",
      name: "users",
      storeName: "db",
      storeRef: "sql:db",
      columns: [{ name: "id", type: "text", primaryKey: true }],
    };
    const profiles = {
      id: "sql:profiles",
      name: "profiles",
      storeName: "db",
      storeRef: "sql:db",
      columns: [
        { name: "id", type: "text", primaryKey: true },
        {
          name: "user_id",
          type: "text",
          unique: true,
          references: { table: "users", column: "id" },
        },
      ],
    };
    const labels = {
      id: "sql:issue_labels",
      name: "issue_labels",
      storeName: "db",
      storeRef: "sql:db",
      columns: [
        { name: "id", type: "text", primaryKey: true },
        { name: "issue_id", type: "text", references: { table: "issues", column: "id" } },
        { name: "label_id", type: "text", references: { table: "labels", column: "id" } },
      ],
    };
    const issues = {
      id: "sql:issues",
      name: "issues",
      storeName: "db",
      storeRef: "sql:db",
      columns: [{ name: "id", type: "text", primaryKey: true }],
    };
    expect(schemaRelationKind(profiles.columns[1]!, profiles, users)).toBe("one-to-one");
    expect(schemaRelationKind(labels.columns[1]!, labels, issues)).toBe("many-to-many");
    expect(schemaRelationLabel("many-to-one", "team_id")).toBe("Many-to-one team_id");
    expect(schemaRelationLabel("one-to-one", "user_id")).toBe("One-to-one user_id");
    expect(schemaRelationLabel("many-to-many", "issue_id")).toBe("Many-to-many issue_id");
    expect(schemaRelationLabel("self", "parent_id")).toBe("Self parent_id");
  });
});

describe("schemaGraphToSql", () => {
  test("emits CREATE TABLE with PK / NOT NULL / REFERENCES", () => {
    const sql = schemaGraphToSql(schemaGraphTables(STORES, MANIFEST));
    expect(sql).toContain("-- db");
    expect(sql).toContain("CREATE TABLE airports");
    expect(sql).toContain("id text PRIMARY KEY");
    expect(sql).toContain("icao text NOT NULL UNIQUE");
    expect(sql).toContain("REFERENCES airports (id)");
  });
});
