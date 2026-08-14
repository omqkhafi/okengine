/**
 * Smart colorize for the schema visualizer — cluster tables, then paint.
 *
 * Clusters: name prefix (`issue_labels` → issues) first, then a single
 * outgoing FK (comments → issues). Hubs keep their own color.
 */

import { MarkerType } from "@xyflow/react";
import type {
  SchemaGraph,
  SchemaGraphEdge,
  SchemaGraphNode,
  SchemaGraphTable,
} from "./schema-graph.ts";

/** Header / edge swatch for one table. */
export type SchemaSwatch = {
  readonly hex: string;
  readonly cluster: string;
};

/** Mono fallback when colorize is off. */
export const SCHEMA_MONO_HEX = "#38BDF8";

/** Distinct hues that stay readable on the dark canvas. */
export const SCHEMA_PALETTE = [
  "#38BDF8",
  "#34D399",
  "#FBBF24",
  "#A78BFA",
  "#FB7185",
  "#22D3EE",
  "#F472B6",
  "#4ADE80",
  "#F59E0B",
  "#818CF8",
] as const;

/**
 * Cluster key per table name (stable, singular).
 *
 * @param tables - Visualizer tables
 */
export function schemaTableClusters(
  tables: readonly SchemaGraphTable[],
): ReadonlyMap<string, string> {
  const names = new Set(tables.map((t) => t.name));
  const out = new Map<string, string>();
  for (const table of tables) {
    out.set(table.name, clusterKey(table, names));
  }
  return out;
}

/**
 * Swatch per table id.
 *
 * @param tables - Visualizer tables
 */
export function schemaTableSwatches(
  tables: readonly SchemaGraphTable[],
): ReadonlyMap<string, SchemaSwatch> {
  const clusters = schemaTableClusters(tables);
  const keys = [...new Set(clusters.values())].sort();
  const hexByCluster = new Map<string, string>();
  for (const [index, key] of keys.entries()) {
    hexByCluster.set(key, SCHEMA_PALETTE[index] ?? hashSwatch(key));
  }
  const out = new Map<string, SchemaSwatch>();
  for (const table of tables) {
    const cluster = clusters.get(table.name) ?? singularize(table.name);
    out.set(table.id, { cluster, hex: hexByCluster.get(cluster) ?? SCHEMA_MONO_HEX });
  }
  return out;
}

/**
 * Unique cluster swatches for the legend (sorted).
 *
 * @param tables - Visualizer tables
 */
export function schemaClusterLegend(tables: readonly SchemaGraphTable[]): readonly SchemaSwatch[] {
  const seen = new Set<string>();
  const out: SchemaSwatch[] = [];
  for (const swatch of schemaTableSwatches(tables).values()) {
    if (seen.has(swatch.cluster)) continue;
    seen.add(swatch.cluster);
    out.push(swatch);
  }
  return out.sort((a, b) => a.cluster.localeCompare(b.cluster));
}

/**
 * Paint nodes + edges, or flatten to mono.
 *
 * @param graph - Laid-out graph
 * @param enabled - When false, every table uses {@link SCHEMA_MONO_HEX}
 */
export function colorizeSchemaGraph(graph: SchemaGraph, enabled: boolean): SchemaGraph {
  const swatches = enabled
    ? schemaTableSwatches(graph.tables)
    : new Map(graph.tables.map((table) => [table.id, { cluster: "schema", hex: SCHEMA_MONO_HEX }]));
  const hexByName = new Map<string, string>();
  for (const table of graph.tables) {
    const hex = swatches.get(table.id)?.hex;
    if (hex) hexByName.set(table.name, hex);
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => applyNodeSwatch(node, swatches.get(node.id), hexByName)),
    edges: graph.edges.map((edge) => applyEdgeSwatch(edge, swatches.get(edge.target))),
  };
}

function applyNodeSwatch(
  node: SchemaGraphNode,
  swatch: SchemaSwatch | undefined,
  hexByName: ReadonlyMap<string, string>,
): SchemaGraphNode {
  const color = swatch ?? { cluster: "schema", hex: SCHEMA_MONO_HEX };
  const refHex: Record<string, string> = {};
  for (const col of node.data.table.columns) {
    const target = col.references?.table;
    const hex = target ? hexByName.get(target) : undefined;
    if (hex) refHex[col.name] = hex;
  }
  return {
    ...node,
    data: {
      ...node.data,
      color,
      ...(Object.keys(refHex).length > 0 ? { refHex } : {}),
    },
  };
}

function applyEdgeSwatch(edge: SchemaGraphEdge, swatch: SchemaSwatch | undefined): SchemaGraphEdge {
  const hex = swatch?.hex ?? SCHEMA_MONO_HEX;
  const inferred = edge.data?.inferred === true;
  return {
    ...edge,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: hex,
    },
    style: {
      stroke: hex,
      strokeWidth: 1.5,
      ...(inferred ? { strokeDasharray: "5 4" } : {}),
    },
    data: {
      kind: "references",
      inferred,
      relation: edge.data?.relation ?? "many-to-one",
      column: edge.data?.column ?? "",
      hex,
    },
  };
}

function clusterKey(table: SchemaGraphTable, names: ReadonlySet<string>): string {
  const prefix = prefixHub(table.name, names);
  if (prefix) return prefix;
  if (isPrefixHub(table.name, names)) return singularize(table.name);
  const fks = table.columns.filter(
    (col) => col.references?.table && col.references.table !== table.name,
  );
  if (fks.length === 1) {
    const target = fks[0]?.references?.table;
    if (target) {
      return prefixHub(target, names) ?? singularize(target);
    }
  }
  return singularize(table.name);
}

function prefixHub(name: string, names: ReadonlySet<string>): string | null {
  const prefix = name.split("_")[0];
  if (!prefix || prefix === name) return null;
  for (const hub of [prefix, `${prefix}s`, pluralize(prefix)]) {
    if (names.has(hub) && hub !== name) return singularize(hub);
  }
  return null;
}

function isPrefixHub(name: string, names: ReadonlySet<string>): boolean {
  const key = singularize(name);
  for (const other of names) {
    if (other === name) continue;
    if (prefixHub(other, names) === key) return true;
  }
  return false;
}

function pluralize(stem: string): string {
  if (stem.endsWith("y") && !/[aeiou]y$/i.test(stem)) return `${stem.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(stem)) return `${stem}es`;
  return `${stem}s`;
}

function singularize(name: string): string {
  if (name.endsWith("ies") && name.length > 3) return `${name.slice(0, -3)}y`;
  if (/(?:ses|xes|zes|ches|shes)$/i.test(name)) return name.slice(0, -2);
  if (name.endsWith("s") && !name.endsWith("ss") && name.length > 1) return name.slice(0, -1);
  return name;
}

function hashSwatch(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + (key.codePointAt(i) ?? 0)) >>> 0;
  }
  return `hsl(${hash % 360} 70% 62%)`;
}
