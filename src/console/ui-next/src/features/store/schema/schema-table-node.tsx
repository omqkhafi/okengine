/**
 * Schema visualizer table card — columns, PK / nullability, FK handles.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { JSX } from "react";
import { ShieldEnergyIcon, ShieldOff } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils.ts";
import {
  schemaRelationLabel,
  type SchemaGraphColumn,
  type SchemaGraphNodeData,
  type SchemaRelationKind,
} from "../lib/schema-graph.ts";
import { SchemaColumnMarks } from "./schema-constraint-icon.tsx";
import { SchemaRelationIcon } from "./schema-relation-icon.tsx";

type SchemaTableNode = Node<SchemaGraphNodeData, "table">;

/**
 * React Flow node for one SQL table.
 *
 * @param props - xyflow node props
 */
export function SchemaTableNode({ data }: NodeProps<SchemaTableNode>): JSX.Element {
  const { table, showStore, dimmed, selected, color, refHex } = data;
  const hex = color?.hex ?? "#38BDF8";
  return (
    <div
      data-slot="store-schema-table"
      data-table={table.name}
      data-cluster={color?.cluster}
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card text-[11px] shadow-sm",
        dimmed && "opacity-30 saturate-[0.4]",
      )}
      style={{
        borderColor: selected ? hex : `color-mix(in oklab, ${hex} 42%, var(--border))`,
        boxShadow: selected ? `0 0 0 2px color-mix(in oklab, ${hex} 35%, transparent)` : undefined,
      }}
    >
      <div
        className="flex h-8 shrink-0 items-center gap-1.5 border-b px-2"
        style={{
          background: `color-mix(in oklab, ${hex} 22%, var(--card))`,
          borderColor: `color-mix(in oklab, ${hex} 28%, var(--border))`,
        }}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: hex }} aria-hidden />
        <span className="min-w-0 truncate font-semibold text-foreground">{table.name}</span>
        <span
          data-slot="store-schema-rls"
          data-rls={table.rls === true ? "on" : "off"}
          title={table.rls === true ? "RLS enabled" : "RLS disabled"}
          className={cn(
            "shrink-0",
            table.rls === true ? "text-emerald-500" : "text-muted-foreground/35",
          )}
        >
          <HugeiconsIcon
            icon={table.rls === true ? ShieldEnergyIcon : ShieldOff}
            className="size-3"
            aria-hidden
          />
        </span>
        {showStore ? (
          <span className="ml-auto shrink-0 font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
            {table.storeName}
          </span>
        ) : (
          <span className="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground">
            {table.columns.length}
          </span>
        )}
      </div>
      <ul className="flex min-h-0 flex-1 flex-col">
        {table.columns.length === 0 ? (
          <li className="relative flex h-[22px] items-center px-2 text-muted-foreground">
            No columns
          </li>
        ) : (
          table.columns.map((col) => (
            <ColumnRow
              key={col.name}
              column={col}
              tableName={table.name}
              junction={isJunctionCard(table.columns)}
              tableHex={hex}
              refHex={refHex?.[col.name]}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function ColumnRow({
  column,
  tableName,
  junction,
  tableHex,
  refHex,
}: {
  readonly column: SchemaGraphColumn;
  readonly tableName: string;
  readonly junction: boolean;
  readonly tableHex: string;
  readonly refHex?: string;
}): JSX.Element {
  const handleHex = refHex ?? tableHex;
  const typeTone =
    column.type === "integer"
      ? "text-teal-600 dark:text-teal-400"
      : column.type === "text"
        ? "text-muted-foreground"
        : "text-muted-foreground/80";
  return (
    <li className="relative flex h-[22px] items-center gap-1.5 px-2">
      <Handle
        type="target"
        position={Position.Left}
        id={`in:${column.name}`}
        className="!size-1.5 !border-0"
        style={{ background: tableHex }}
      />
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          column.nullable === false ? "bg-foreground/70" : "border border-foreground/50",
        )}
        title={column.nullable === false ? "Not null" : "Nullable"}
        aria-hidden
      />
      <SchemaColumnMarks
        primaryKey={column.primaryKey}
        foreignKey={column.references !== undefined}
        unique={column.unique}
        inferred={column.inferredRef}
        hex={handleHex}
      />
      <span
        className={cn("min-w-0 truncate font-mono text-[10px]", !refHex && "text-foreground")}
        style={refHex ? { color: refHex } : undefined}
        title={fkTitle(column)}
      >
        {column.name}
      </span>
      {column.references?.table ? (
        <span
          className="inline-flex max-w-[6rem] shrink-0 items-center gap-0.5 truncate text-muted-foreground"
          title={fkTitle(column, tableName, junction)}
        >
          <SchemaRelationIcon
            kind={relationKind(column, tableName, junction)}
            hex={handleHex}
            className="size-3"
          />
          <span className="truncate font-mono text-[8px]">{column.references.table}</span>
        </span>
      ) : null}
      <span className={cn("ml-auto shrink-0 font-mono text-[9px]", typeTone)}>{column.type}</span>
      {column.pii ? (
        <span className="shrink-0 rounded border border-border/70 px-1 text-[8px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          PII
        </span>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        id={`out:${column.name}`}
        className="!size-1.5 !border-0"
        style={{ background: handleHex }}
      />
    </li>
  );
}

function isJunctionCard(columns: readonly SchemaGraphColumn[]): boolean {
  const fks = columns.filter((col) => col.references?.table);
  if (fks.length < 2) return false;
  return columns.every((col) => col.primaryKey === true || col.references !== undefined);
}

function relationKind(
  column: SchemaGraphColumn,
  tableName: string,
  junction: boolean,
): SchemaRelationKind {
  if (column.references?.table === tableName) return "self";
  if (column.unique === true || column.primaryKey === true) return "one-to-one";
  if (junction) return "many-to-many";
  return "many-to-one";
}

function fkTitle(
  column: SchemaGraphColumn,
  tableName?: string,
  junction = false,
): string | undefined {
  if (!column.references) return undefined;
  const target = column.references.column
    ? `${column.references.table}.${column.references.column}`
    : column.references.table;
  const kind =
    tableName !== undefined
      ? schemaRelationLabel(relationKind(column, tableName, junction), column.name)
      : "FK";
  return `${column.inferredRef ? "Inferred" : "Declared"} ${kind} → ${target}`;
}

/** nodeTypes registry for the schema visualizer. */
export const schemaGraphNodeTypes = {
  table: SchemaTableNode,
};
