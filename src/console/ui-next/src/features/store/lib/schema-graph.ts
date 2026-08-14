/**
 * Manifest + store-list → schema visualizer graph (tables, columns, FK edges).
 */

import dagre from "@dagrejs/dagre";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type {
  ColumnClassification,
  DeclaredColumn,
  Manifest,
  Table,
} from "../../../../../../manifest/types.ts";
import type { StoreListStore } from "@/client.ts";
import type { SchemaSwatch } from "./schema-color.ts";
import { isSqlCatalogChild } from "./sql-catalog.ts";

/** Column drawn on a schema-visualizer table card. */
export type SchemaGraphColumn = {
  readonly name: string;
  readonly type: string;
  readonly pii?: boolean;
  readonly primaryKey?: boolean;
  readonly unique?: boolean;
  readonly nullable?: boolean;
  readonly references?: { readonly table: string; readonly column?: string };
  /** True when {@link references} was inferred from an `*_id` column name. */
  readonly inferredRef?: boolean;
};

/** One SQL table in the schema visualizer. */
export type SchemaGraphTable = {
  readonly id: string;
  readonly name: string;
  readonly storeName: string;
  readonly storeRef: string;
  readonly columns: readonly SchemaGraphColumn[];
};

/** Custom data on a schema-visualizer table node. */
export type SchemaGraphNodeData = {
  readonly table: SchemaGraphTable;
  readonly showStore: boolean;
  readonly color?: SchemaSwatch;
  /** FK column name → target table hex (smart colorize). */
  readonly refHex?: Readonly<Record<string, string>>;
  readonly dimmed?: boolean;
  readonly selected?: boolean;
};

/** React Flow node for a schema table card. */
export type SchemaGraphNode = Node<SchemaGraphNodeData, "table">;

/** Cardinality drawn on a schema-visualizer edge. */
export type SchemaRelationKind = "one-to-one" | "many-to-one" | "many-to-many" | "self";

/** React Flow edge for a declared or inferred foreign key. */
export type SchemaGraphEdge = Edge<
  {
    readonly kind: "references";
    readonly inferred: boolean;
    readonly relation: SchemaRelationKind;
    readonly column: string;
    readonly hex?: string;
  },
  "relation"
>;

/** Built visualizer graph. */
export type SchemaGraph = {
  readonly tables: readonly SchemaGraphTable[];
  readonly nodes: readonly SchemaGraphNode[];
  readonly edges: readonly SchemaGraphEdge[];
};

const NODE_WIDTH = 248;
const HEADER_H = 32;
const COL_H = 22;
const NODE_PAD = 4;

/**
 * Card height for a table (header + one row per column).
 *
 * @param columnCount - Columns on the card
 */
export function schemaNodeHeight(columnCount: number): number {
  return HEADER_H + Math.max(columnCount, 1) * COL_H + NODE_PAD;
}

/**
 * Cardinality for an FK column from `from` → `target`.
 *
 * @param column - FK column
 * @param from - Source table
 * @param target - Referenced table
 */
export function schemaRelationKind(
  column: SchemaGraphColumn,
  from: SchemaGraphTable,
  target: SchemaGraphTable,
): SchemaRelationKind {
  if (from.id === target.id) return "self";
  if (column.unique === true || column.primaryKey === true) return "one-to-one";
  if (isJunctionTable(from)) return "many-to-many";
  return "many-to-one";
}

/**
 * Accessible title for a relation glyph (`Many-to-one issue_id`).
 *
 * @param kind - Cardinality
 * @param column - FK column name
 */
export function schemaRelationLabel(kind: SchemaRelationKind, column: string): string {
  const mark =
    kind === "one-to-one"
      ? "One-to-one"
      : kind === "many-to-many"
        ? "Many-to-many"
        : kind === "self"
          ? "Self"
          : "Many-to-one";
  return column.length > 0 ? `${mark} ${column}` : mark;
}

/**
 * Tables for the SQL schema visualizer (catalog folders omitted).
 *
 * @param stores - Projected store rows
 * @param manifest - Current Manifest
 */
export function schemaGraphTables(
  stores: readonly StoreListStore[],
  manifest: Manifest | null,
): readonly SchemaGraphTable[] {
  const out: SchemaGraphTable[] = [];
  for (const store of stores) {
    if (store.facet !== "sql") continue;
    for (const child of store.children) {
      if (isSqlCatalogChild(child)) continue;
      out.push({
        id: child.effectRef,
        name: child.name,
        storeName: store.name,
        storeRef: store.ref,
        columns: columnsForChild(
          store,
          child.name,
          child.columnDescriptions,
          child.piiColumns,
          manifest,
        ),
      });
    }
  }
  return inferSchemaReferences(out);
}

/**
 * Layout tables + FK edges for React Flow.
 *
 * @param tables - Visualizer tables
 */
export function buildSchemaGraph(tables: readonly SchemaGraphTable[]): SchemaGraph {
  const showStore = new Set(tables.map((t) => t.storeRef)).size > 1;
  const byName = indexTablesByName(tables);
  const edges = schemaGraphEdges(tables, byName);
  const nodes = layoutSchemaNodes(tables, edges, showStore);
  return { tables, nodes, edges };
}

/**
 * Selected table plus every table sharing an FK edge. `null` when the
 * selection has no relations (do not dim the rest of the canvas).
 *
 * @param edges - Visualizer edges
 * @param selectedId - Selected effectRef
 */
export function schemaNeighborIds(
  edges: readonly SchemaGraphEdge[],
  selectedId: string | null,
): ReadonlySet<string> | null {
  if (!selectedId) return null;
  const neighbors = new Set<string>([selectedId]);
  for (const edge of edges) {
    if (edge.source === selectedId) neighbors.add(edge.target);
    if (edge.target === selectedId) neighbors.add(edge.source);
  }
  return neighbors.size > 1 ? neighbors : null;
}

/**
 * Dim / select flags for the live canvas (search + relation focus).
 *
 * @param nodes - Laid-out nodes
 * @param query - Find-table needle
 * @param selectedId - Selected effectRef
 * @param edges - Visualizer edges (relation neighborhood)
 * @param isolate - When false, skip relation dimming
 */
export function emphasizeSchemaNodes(
  nodes: readonly SchemaGraphNode[],
  query: string,
  selectedId: string | null,
  edges: readonly SchemaGraphEdge[] = [],
  isolate = true,
): SchemaGraphNode[] {
  const needle = query.trim().toLowerCase();
  const neighbors = isolate ? schemaNeighborIds(edges, selectedId) : null;
  return nodes.map((node) => {
    const hit =
      needle.length === 0 ||
      node.data.table.name.toLowerCase().includes(needle) ||
      node.data.table.storeName.toLowerCase().includes(needle);
    const selected = selectedId !== null && node.id === selectedId;
    const searchMiss = needle.length > 0 && !hit;
    const relationMiss = neighbors !== null && !neighbors.has(node.id);
    return {
      ...node,
      data: {
        ...node.data,
        dimmed: searchMiss || relationMiss,
        selected,
      },
    };
  });
}

/**
 * Fade edges that do not touch the focused table.
 *
 * @param edges - Visualizer edges
 * @param selectedId - Selected effectRef
 * @param isolate - When false, skip relation dimming
 * @param animate - When false, skip dash flow on focused edges
 */
export function emphasizeSchemaEdges(
  edges: readonly SchemaGraphEdge[],
  selectedId: string | null,
  isolate = true,
  animate = true,
): SchemaGraphEdge[] {
  const neighbors = isolate ? schemaNeighborIds(edges, selectedId) : null;
  return edges.map((edge) => {
    const dimmed = neighbors !== null && edge.source !== selectedId && edge.target !== selectedId;
    const focused = neighbors !== null && !dimmed;
    return {
      ...edge,
      animated: animate && focused,
      style: {
        ...edge.style,
        opacity: dimmed ? 0.14 : 1,
        strokeWidth: focused ? 2.25 : dimmed ? 1 : 1.5,
      },
    };
  });
}

/**
 * `CREATE TABLE` preview from the visualizer model (Manifest types only).
 *
 * @param tables - Visualizer tables
 */
export function schemaGraphToSql(tables: readonly SchemaGraphTable[]): string {
  const blocks: string[] = [];
  let lastStore: string | null = null;
  for (const table of tables) {
    if (table.storeName !== lastStore) {
      blocks.push(`-- ${table.storeName}`);
      lastStore = table.storeName;
    }
    const cols = table.columns.map((col) => {
      const bits = [`  ${quoteIdent(col.name)}`, col.type];
      if (col.primaryKey) bits.push("PRIMARY KEY");
      else if (col.nullable === false) bits.push("NOT NULL");
      if (col.unique && !col.primaryKey) bits.push("UNIQUE");
      if (col.references?.table && col.inferredRef !== true) {
        const target = col.references.column
          ? `${quoteIdent(col.references.table)} (${quoteIdent(col.references.column)})`
          : quoteIdent(col.references.table);
        bits.push(`REFERENCES ${target}`);
      }
      return bits.join(" ");
    });
    const body = cols.length > 0 ? `\n${cols.join(",\n")}\n` : "\n";
    blocks.push(`CREATE TABLE ${quoteIdent(table.name)} (${body});`);
  }
  return blocks.join("\n\n");
}

function columnsForChild(
  store: StoreListStore,
  tableName: string,
  descriptions: Readonly<Record<string, string>>,
  piiColumns: readonly string[],
  manifest: Manifest | null,
): SchemaGraphColumn[] {
  const table = manifest?.stores?.[store.name]?.tables?.[tableName];
  if (table?.columns) return columnsFromManifest(table.columns, piiColumns);
  const names = [...new Set([...Object.keys(descriptions), ...piiColumns])];
  return names.map((name) => ({
    name,
    type: "unknown",
    ...(piiColumns.includes(name) ? { pii: true } : {}),
  }));
}

function columnsFromManifest(
  columns: NonNullable<Table["columns"]>,
  piiColumns: readonly string[],
): SchemaGraphColumn[] {
  return Object.entries(columns).map(([name, col]) => {
    const declared = isDeclaredColumn(col) ? col : null;
    const type =
      declared?.type === "integer" ? "integer" : declared?.type === "text" ? "text" : "unknown";
    const pii = col.pii === true || piiColumns.includes(name);
    const ref = declared?.references;
    return {
      name,
      type,
      ...(pii ? { pii: true } : {}),
      ...(declared?.primaryKey === true ? { primaryKey: true } : {}),
      ...(declared?.unique === true ? { unique: true } : {}),
      ...(declared?.nullable === false || declared?.primaryKey === true
        ? { nullable: false }
        : { nullable: true }),
      ...(ref?.table
        ? { references: { table: ref.table, ...(ref.column ? { column: ref.column } : {}) } }
        : {}),
    };
  });
}

function isDeclaredColumn(col: DeclaredColumn | ColumnClassification): col is DeclaredColumn {
  return (
    "type" in col ||
    "nullable" in col ||
    "primaryKey" in col ||
    "unique" in col ||
    "sqlName" in col ||
    "description" in col ||
    "references" in col ||
    "default" in col
  );
}

/**
 * Fill missing FKs from `*_id` column names when Manifest omitted `.references()`.
 *
 * @param tables - Visualizer tables
 */
export function inferSchemaReferences(
  tables: readonly SchemaGraphTable[],
): readonly SchemaGraphTable[] {
  return tables.map((table) => ({
    ...table,
    columns: table.columns.map((col) => {
      if (col.references?.table) return col;
      const inferred = inferColumnReference(table, col.name, tables);
      if (!inferred) return col;
      return { ...col, references: inferred, inferredRef: true };
    }),
  }));
}

function inferColumnReference(
  from: SchemaGraphTable,
  column: string,
  tables: readonly SchemaGraphTable[],
): { readonly table: string; readonly column: string } | null {
  const peers = tables.filter((t) => t.storeRef === from.storeRef);
  const pkOf = (table: SchemaGraphTable): string =>
    table.columns.find((c) => c.primaryKey)?.name ?? "id";

  if (column === "parent_id") {
    if (from.columns.some((c) => c.name === "parent_kind")) return null;
    return { table: from.name, column: pkOf(from) };
  }
  if (!column.endsWith("_id") || column === "id") return null;
  const stem = column.slice(0, -3);
  if (stem.length === 0) return null;
  const target = matchTableForStem(stem, from, peers);
  if (!target) return null;
  return { table: target.name, column: pkOf(target) };
}

function matchTableForStem(
  stem: string,
  from: SchemaGraphTable,
  tables: readonly SchemaGraphTable[],
): SchemaGraphTable | null {
  const snake = camelToSnake(stem);
  const candidates = [stem, snake, pluralizeSqlName(stem), pluralizeSqlName(snake)];
  for (const name of candidates) {
    const hit = tables.find((t) => t.name === name);
    if (!hit) continue;
    if (hit.id === from.id) return null;
    return hit;
  }
  const suffixes = [
    `_${pluralizeSqlName(snake)}`,
    `_${snake}`,
    `_${pluralizeSqlName(stem)}`,
    `_${stem}`,
  ];
  const suffixHits = tables.filter(
    (t) => t.id !== from.id && suffixes.some((suffix) => t.name.endsWith(suffix)),
  );
  return suffixHits.length === 1 ? (suffixHits[0] ?? null) : null;
}

function pluralizeSqlName(stem: string): string {
  if (stem.endsWith("y") && !/[aeiou]y$/i.test(stem)) return `${stem.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(stem)) return `${stem}es`;
  return `${stem}s`;
}

function camelToSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function indexTablesByName(
  tables: readonly SchemaGraphTable[],
): ReadonlyMap<string, readonly SchemaGraphTable[]> {
  const map = new Map<string, SchemaGraphTable[]>();
  for (const table of tables) {
    const keys = [table.name.toLowerCase(), table.id.toLowerCase()];
    for (const key of keys) {
      const list = map.get(key) ?? [];
      list.push(table);
      map.set(key, list);
    }
  }
  return map;
}

function resolveRefTable(
  from: SchemaGraphTable,
  refName: string,
  byName: ReadonlyMap<string, readonly SchemaGraphTable[]>,
): SchemaGraphTable | null {
  const hits = byName.get(refName.toLowerCase()) ?? [];
  if (hits.length === 0) return null;
  return hits.find((t) => t.storeRef === from.storeRef) ?? hits[0] ?? null;
}

function schemaGraphEdges(
  tables: readonly SchemaGraphTable[],
  byName: ReadonlyMap<string, readonly SchemaGraphTable[]>,
): SchemaGraphEdge[] {
  const edges: SchemaGraphEdge[] = [];
  const seen = new Set<string>();
  for (const table of tables) {
    for (const col of table.columns) {
      const ref = col.references;
      if (!ref?.table) continue;
      const target = resolveRefTable(table, ref.table, byName);
      if (!target) continue;
      const targetCol = ref.column ?? target.columns.find((c) => c.primaryKey)?.name;
      const id = `${table.id}.${col.name}->${target.id}.${targetCol ?? "*"}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const inferred = col.inferredRef === true;
      const relation = schemaRelationKind(col, table, target);
      edges.push({
        id,
        source: table.id,
        target: target.id,
        sourceHandle: `out:${col.name}`,
        ...(targetCol ? { targetHandle: `in:${targetCol}` } : {}),
        type: "relation",
        animated: false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: "#38BDF8",
        },
        style: {
          stroke: "#38BDF8",
          strokeWidth: 1.5,
          ...(inferred ? { strokeDasharray: "5 4" } : {}),
        },
        data: { kind: "references", inferred, relation, column: col.name },
      });
    }
  }
  return edges;
}

function layoutSchemaNodes(
  tables: readonly SchemaGraphTable[],
  edges: readonly SchemaGraphEdge[],
  showStore: boolean,
): SchemaGraphNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    align: "UL",
    nodesep: 72,
    ranksep: 160,
    edgesep: 28,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const table of tables) {
    g.setNode(table.id, { width: NODE_WIDTH, height: schemaNodeHeight(table.columns.length) });
  }
  const linked = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.source}->${edge.target}`;
    if (linked.has(key)) continue;
    if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
    linked.add(key);
    g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);

  return tables.map((table) => {
    const n = g.node(table.id);
    const height = schemaNodeHeight(table.columns.length);
    return {
      id: table.id,
      type: "table" as const,
      position: {
        x: (n?.x ?? 0) - NODE_WIDTH / 2,
        y: (n?.y ?? 0) - height / 2,
      },
      data: { table, showStore },
      style: { width: NODE_WIDTH, height },
    };
  });
}

function isJunctionTable(table: SchemaGraphTable): boolean {
  const fks = table.columns.filter(
    (col) => col.references?.table && col.references.table !== table.name,
  );
  if (fks.length < 2) return false;
  return table.columns.every((col) => col.primaryKey === true || col.references !== undefined);
}

function quoteIdent(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}
