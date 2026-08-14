/**
 * SQL schema visualizer — table cards + declared / inferred FK edges.
 */

import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { ColorsIcon, Copy01Icon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import "@xyflow/react/dist/style.css";
import type { Manifest } from "../../../../../../manifest/types.ts";
import type { StoreListStore } from "@/client.ts";
import { Input } from "@/components/ui/input";
import { SHEET_SEARCH, SheetTextToggle } from "@/components/ui/sheet-form.tsx";
import { useTheme } from "@/components/theme-provider";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils.ts";
import { colorizeSchemaGraph } from "../lib/schema-color.ts";
import {
  buildSchemaGraph,
  emphasizeSchemaEdges,
  emphasizeSchemaNodes,
  schemaGraphTables,
  schemaGraphToSql,
  type SchemaGraphEdge,
  type SchemaGraphNode,
} from "../lib/schema-graph.ts";
import { SchemaConstraintIcon } from "./schema-constraint-icon.tsx";
import { schemaGraphEdgeTypes } from "./schema-relation-edge.tsx";
import { SchemaRelationIcon } from "./schema-relation-icon.tsx";
import { schemaGraphNodeTypes } from "./schema-table-node.tsx";

/** Props for {@link SchemaVisualizer}. */
export interface SchemaVisualizerProps {
  readonly stores: readonly StoreListStore[];
  readonly manifest: Manifest | null;
  readonly selectedEffectRef: string | null;
  readonly onSelectTable: (effectRef: string) => void;
}

/**
 * Full-pane ER canvas for Manifest SQL tables.
 *
 * @param props - Stores + Manifest + selection
 */
export function SchemaVisualizer(props: SchemaVisualizerProps): JSX.Element {
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-slot="store-schema-visualizer"
    >
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}

function Canvas({
  stores,
  manifest,
  selectedEffectRef,
  onSelectTable,
}: SchemaVisualizerProps): JSX.Element {
  const { fitView } = useReactFlow();
  const { theme } = useTheme();
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [layoutTick, setLayoutTick] = useState(0);
  const [copied, setCopied] = useState(false);
  const [colorize, setColorize] = useState(true);
  const [isolate, setIsolate] = useState(true);

  const colorMode =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  const tables = useMemo(() => schemaGraphTables(stores, manifest), [stores, manifest]);
  const graph = useMemo(
    () => colorizeSchemaGraph(buildSchemaGraph(tables), colorize),
    [tables, colorize],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<SchemaGraphNode>([...graph.nodes]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<SchemaGraphEdge>([...graph.edges]);

  useEffect(() => {
    setNodes(emphasizeSchemaNodes(graph.nodes, query, selectedEffectRef, graph.edges, isolate));
    setEdges(emphasizeSchemaEdges(graph.edges, selectedEffectRef, isolate, reduceMotion !== true));
  }, [graph, isolate, layoutTick, query, reduceMotion, selectedEffectRef, setEdges, setNodes]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void fitView({ padding: 0.18, duration: 240 });
    }, 40);
    return () => window.clearTimeout(id);
  }, [fitView, layoutTick, tables.length]);

  const copySql = useCallback(async () => {
    const sql = schemaGraphToSql(tables);
    if (sql.length === 0) return;
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }, [tables]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center border-b border-border/50">
        <span className="px-3 font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Schema
        </span>
        <label className="relative min-w-0 flex-1">
          <HugeiconsIcon
            icon={Search01Icon}
            className="pointer-events-none absolute top-1/2 left-0 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find table…"
            aria-label="Find table"
            flat
            className={cn(SHEET_SEARCH, "pl-5")}
            data-slot="store-schema-find"
          />
        </label>
        <span className="px-2 tabular-nums text-[10px] text-muted-foreground">
          {tables.length} table{tables.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-3 px-3">
          <SheetTextToggle
            active={colorize}
            aria-pressed={colorize}
            onClick={() => setColorize((v) => !v)}
            data-slot="store-schema-colorize"
          >
            <HugeiconsIcon icon={ColorsIcon} className="size-3" aria-hidden />
            Colorize
          </SheetTextToggle>
          <SheetTextToggle
            active={copied}
            disabled={tables.length === 0}
            onClick={() => void copySql()}
            className="disabled:pointer-events-none disabled:opacity-40"
            data-slot="store-schema-copy-sql"
          >
            <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} className="size-3" aria-hidden />
            {copied ? "Copied" : "Copy as SQL"}
          </SheetTextToggle>
          <SheetTextToggle
            active={false}
            disabled={tables.length === 0}
            onClick={() => setLayoutTick((n) => n + 1)}
            className="disabled:pointer-events-none disabled:opacity-40"
            data-slot="store-schema-auto-layout"
          >
            Auto layout
          </SheetTextToggle>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {tables.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">No SQL tables to visualize.</p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={schemaGraphNodeTypes}
            edgeTypes={schemaGraphEdgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            colorMode={colorMode}
            fitView
            nodesConnectable={false}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
            minZoom={0.15}
            maxZoom={1.8}
            defaultEdgeOptions={{
              type: "relation",
              style: { stroke: "#38BDF8", strokeWidth: 1.5 },
            }}
            onNodeClick={(_, node) => {
              setIsolate(true);
              onSelectTable(node.id);
            }}
            onPaneClick={() => setIsolate(false)}
            data-slot="store-schema-canvas"
          >
            <Background
              gap={24}
              size={1}
              color="color-mix(in oklab, var(--foreground) 14%, transparent)"
            />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              ariaLabel="Schema graph overview"
              bgColor="var(--card)"
              maskColor="color-mix(in oklab, var(--background) 55%, transparent)"
              nodeColor={(node) => {
                const hex = (node.data as SchemaGraphNode["data"]).color?.hex;
                return hex ?? "#64748B";
              }}
              nodeStrokeColor="transparent"
              nodeStrokeWidth={12}
              nodeBorderRadius={8}
            />
          </ReactFlow>
        )}
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[min(720px,calc(100%-2rem))] -translate-x-1/2">
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-md border border-border/60 bg-background/80 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
            <span className="inline-flex items-center gap-0.5">
              <SchemaConstraintIcon kind="pk" />
              primary
            </span>
            <span className="inline-flex items-center gap-0.5">
              <SchemaConstraintIcon kind="fk" />
              foreign
            </span>
            <span className="inline-flex items-center gap-0.5">
              <SchemaConstraintIcon kind="unique" />
              unique
            </span>
            <span className="inline-flex items-center gap-0.5">
              <SchemaRelationIcon kind="many-to-one" />
              many
            </span>
            <span className="inline-flex items-center gap-0.5">
              <SchemaRelationIcon kind="one-to-one" />
              one
            </span>
            <span className="inline-flex items-center gap-0.5">
              <SchemaRelationIcon kind="many-to-many" />
              join
            </span>
            <span className="inline-flex items-center gap-0.5">
              <SchemaRelationIcon kind="self" />
              self
            </span>
            <span>dashed = inferred</span>
            <span>filled = not null</span>
          </p>
        </div>
      </div>
    </div>
  );
}
