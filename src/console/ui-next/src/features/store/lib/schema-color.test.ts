import { describe, expect, test } from "bun:test";
import type { SchemaGraphTable } from "./schema-graph.ts";
import {
  SCHEMA_MONO_HEX,
  colorizeSchemaGraph,
  schemaClusterLegend,
  schemaTableClusters,
} from "./schema-color.ts";
import { buildSchemaGraph } from "./schema-graph.ts";

function table(
  name: string,
  refs: ReadonlyArray<{ readonly column: string; readonly table: string }> = [],
): SchemaGraphTable {
  return {
    id: `sql:${name}`,
    name,
    storeName: "db",
    storeRef: "sql:db",
    columns: [
      { name: "id", type: "text", primaryKey: true, nullable: false },
      ...refs.map((ref) => ({
        name: ref.column,
        type: "text",
        references: { table: ref.table, column: "id" },
        inferredRef: true,
      })),
    ],
  };
}

const SEED: readonly SchemaGraphTable[] = [
  table("teams", [{ column: "parent_id", table: "teams" }]),
  table("members", [{ column: "team_id", table: "teams" }]),
  table("cycles", [{ column: "team_id", table: "teams" }]),
  table("issues", [
    { column: "team_id", table: "teams" },
    { column: "project_id", table: "projects" },
  ]),
  table("issue_labels", [
    { column: "issue_id", table: "issues" },
    { column: "label_id", table: "labels" },
  ]),
  table("comments", [{ column: "issue_id", table: "issues" }]),
  table("customer_requests", [{ column: "issue_id", table: "issues" }]),
  table("projects", [{ column: "initiative_id", table: "initiatives" }]),
  table("project_milestones", [{ column: "project_id", table: "projects" }]),
  table("initiatives"),
  table("labels", [{ column: "team_id", table: "teams" }]),
  table("documents"),
];

describe("schemaTableClusters", () => {
  test("groups prefix children and single-FK satellites", () => {
    const clusters = schemaTableClusters(SEED);
    expect(clusters.get("issue_labels")).toBe("issue");
    expect(clusters.get("comments")).toBe("issue");
    expect(clusters.get("customer_requests")).toBe("issue");
    expect(clusters.get("issues")).toBe("issue");
    expect(clusters.get("project_milestones")).toBe("project");
    expect(clusters.get("projects")).toBe("project");
    expect(clusters.get("members")).toBe("team");
    expect(clusters.get("cycles")).toBe("team");
    expect(clusters.get("labels")).toBe("team");
    expect(clusters.get("teams")).toBe("team");
    expect(clusters.get("initiatives")).toBe("initiative");
    expect(clusters.get("documents")).toBe("document");
  });
});

describe("colorizeSchemaGraph", () => {
  test("paints related tables the same hex and edges as the target", () => {
    const graph = colorizeSchemaGraph(buildSchemaGraph(SEED), true);
    const comments = graph.nodes.find((n) => n.id === "sql:comments");
    const issues = graph.nodes.find((n) => n.id === "sql:issues");
    const projects = graph.nodes.find((n) => n.id === "sql:projects");
    expect(comments?.data.color?.cluster).toBe("issue");
    expect(comments?.data.color?.hex).toBe(issues?.data.color?.hex);
    expect(projects?.data.color?.cluster).toBe("project");
    expect(projects?.data.color?.hex).not.toBe(issues?.data.color?.hex);
    const edge = graph.edges.find((e) => e.id.includes("comments.issue_id"));
    expect(edge?.data?.hex).toBe(issues?.data.color?.hex);
    expect(comments?.data.refHex?.issue_id).toBe(issues?.data.color?.hex);
  });

  test("mono flattens every swatch", () => {
    const graph = colorizeSchemaGraph(buildSchemaGraph(SEED), false);
    expect(new Set(graph.nodes.map((n) => n.data.color?.hex))).toEqual(new Set([SCHEMA_MONO_HEX]));
    expect(schemaClusterLegend(SEED).length).toBeGreaterThan(3);
  });
});
