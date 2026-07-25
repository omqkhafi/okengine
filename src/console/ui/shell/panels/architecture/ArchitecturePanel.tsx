/**
 * Architecture panel — system shape from the Flows causality graph (§9.13).
 *
 * View-only: no destructive actions, no preview affordance. B and D do not apply.
 * Reuses {@link buildCausalityGraph} — does not recompute causality.
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useMemo } from "react";
import {
  buildArchitectureView,
  clearFocus,
  ELEMENT_LAYERS,
  focusNode,
  LAYER_LABEL,
  layersOf,
  serializeArchitectureSearch,
  setDepth,
  setLayerSearch,
  type ArchitectureSearch,
} from "../../../architecture/index.ts";
import { layoutNodes, SYSTEM_BOUNDARY } from "../../../architecture/layout.ts";
import { buildCausalityGraph } from "../../../flows/graph.ts";
import type { Manifest } from "../../../../../manifest/types.ts";
import { rowToRun, type RunsListRow } from "../../../runs/index.ts";
import { consoleCalls } from "../../client.ts";
import { Button } from "../../components/ui.tsx";

/**
 * Architecture panel. Focus / depth / layers live in URL search params.
 */
export function ArchitecturePanel() {
  const search = useSearch({ from: "/architecture" }) as ArchitectureSearch;
  const navigate = useNavigate({ from: "/architecture" });

  const setSearch = (next: ArchitectureSearch) => {
    void navigate({
      search: serializeArchitectureSearch(next) as never,
      replace: true,
    });
  };

  const manifestQuery = useQuery({
    queryKey: ["console.manifest.get"],
    queryFn: async () => {
      const res = await consoleCalls.manifestGet();
      if (res.error) throw new Error(res.error.code);
      return (res.data as { manifest: Manifest | null }).manifest;
    },
  });

  const runsQuery = useQuery({
    queryKey: ["console.runs.list"],
    queryFn: async () => {
      const res = await consoleCalls.runsList();
      if (res.error) throw new Error(res.error.code);
      return (res.data as { runs: RunsListRow[] }).runs.map(rowToRun);
    },
    refetchInterval: 10_000,
  });

  const graph = useMemo(
    () => buildCausalityGraph(manifestQuery.data),
    [manifestQuery.data],
  );

  const layerFlags = layersOf(search);
  const view = useMemo(
    () =>
      buildArchitectureView(graph, {
        focus: search.focus ?? null,
        depth: search.depth,
        layers: layersOf(search),
        runs: runsQuery.data ?? [],
      }),
    [
      graph,
      search.focus,
      search.depth,
      search.data,
      search.messaging,
      search.time,
      search.external,
      runsQuery.data,
    ],
  );

  const positions = useMemo(() => layoutNodes(view.nodes), [view.nodes]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end gap-4 border-b border-[var(--oke-line)] px-6 py-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--oke-muted)]">
            Architecture
          </p>
          <h1 className="text-xl font-semibold tracking-tight">System shape</h1>
          <p className="text-sm text-[var(--oke-muted)]">
            Clustered by unit · typed layers · traffic from Runs
          </p>
        </div>
        <p
          className="ml-auto font-mono text-sm"
          role="status"
          aria-live="polite"
        >
          <span className="text-[var(--oke-muted)]">Boundary crossings</span>{" "}
          <span className="text-lg font-semibold tabular-nums">
            {view.boundaryCrossingCount}
          </span>
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-0 lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-[var(--oke-line)] px-6 py-3">
            <fieldset className="flex flex-wrap items-center gap-3">
              <legend className="sr-only">Element layers</legend>
              <span className="text-xs uppercase tracking-[0.15em] text-[var(--oke-muted)]">
                Layers
              </span>
              {ELEMENT_LAYERS.map((layer) => (
                <label
                  key={layer}
                  className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={layerFlags[layer]}
                    onChange={(e) =>
                      setSearch(
                        setLayerSearch(search, layer, e.target.checked),
                      )
                    }
                    aria-label={`${LAYER_LABEL[layer]} layer`}
                  />
                  {LAYER_LABEL[layer]}
                </label>
              ))}
            </fieldset>

            {search.focus ? (
              <div className="flex flex-wrap items-center gap-3">
                <fieldset className="flex items-center gap-2">
                  <legend className="sr-only">Focus depth</legend>
                  <span className="text-xs text-[var(--oke-muted)]">Depth</span>
                  {([1, 2] as const).map((d) => (
                    <label
                      key={d}
                      className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-sm"
                    >
                      <input
                        type="radio"
                        name="arch-depth"
                        checked={search.depth === d}
                        onChange={() => setSearch(setDepth(search, d))}
                      />
                      {d}
                    </label>
                  ))}
                </fieldset>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSearch(clearFocus(search))}
                >
                  Clear focus
                </Button>
              </div>
            ) : (
              <p className="text-sm text-[var(--oke-muted)]">
                Select a unit to focus at depth 1–2
              </p>
            )}
          </div>

          <section
            aria-label="System diagram"
            className="min-h-0 flex-1 overflow-auto px-4 py-4"
          >
            <div
              aria-hidden="true"
              className="mb-4 overflow-x-auto"
            >
              <svg
                className="h-auto w-full max-w-5xl text-[var(--oke-fg)]"
                viewBox="0 0 640 380"
              >
                <rect
                  x={SYSTEM_BOUNDARY.x}
                  y={SYSTEM_BOUNDARY.y}
                  width={SYSTEM_BOUNDARY.width}
                  height={SYSTEM_BOUNDARY.height}
                  fill="color-mix(in oklab, var(--oke-fg) 3%, transparent)"
                  stroke="var(--oke-muted)"
                  strokeDasharray="8 5"
                  strokeWidth={1.5}
                  rx={4}
                />
                <text
                  x={SYSTEM_BOUNDARY.x + 12}
                  y={SYSTEM_BOUNDARY.y + 18}
                  className="fill-[var(--oke-muted)]"
                  fontSize={11}
                  fontFamily="var(--oke-mono)"
                >
                  System boundary · {view.boundaryCrossingCount} crossings
                </text>

                {view.edges.map((edge) => {
                  const from = positions.get(edge.from);
                  const to = positions.get(edge.to);
                  if (!from || !to) return null;
                  return (
                    <line
                      key={edge.id}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={
                        edge.layer === "external"
                          ? "var(--oke-external)"
                          : "var(--oke-muted)"
                      }
                      strokeWidth={edge.thickness}
                      strokeDasharray={edge.dashed ? "6 4" : undefined}
                      opacity={edge.dashed ? 0.55 : 0.9}
                    />
                  );
                })}

                {view.nodes.map((node) => {
                  const pos = positions.get(node.id);
                  if (!pos) return null;
                  const r = node.kind === "unit" ? 28 : 22;
                  return (
                    <g key={node.id}>
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={r}
                        fill={
                          node.focused
                            ? "var(--oke-accent)"
                            : node.insideBoundary
                              ? "var(--oke-bg)"
                              : "color-mix(in oklab, var(--oke-external) 25%, var(--oke-bg))"
                        }
                        stroke={
                          node.insideBoundary
                            ? "var(--oke-fg)"
                            : "var(--oke-external)"
                        }
                        strokeWidth={node.focused ? 2.5 : 1.25}
                      />
                      <text
                        x={pos.x}
                        y={pos.y + 4}
                        textAnchor="middle"
                        fontSize={10}
                        fontFamily="var(--oke-mono)"
                        className="fill-[var(--oke-fg)]"
                      >
                        {truncate(node.label, 12)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            <ul
              aria-label="Nodes"
              className="flex flex-wrap gap-2 border-t border-[var(--oke-line)] pt-4"
            >
              {view.nodes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    aria-pressed={n.focused === true}
                    className={clsx(
                      "inline-flex min-h-8 items-center gap-2 border px-3 text-sm",
                      n.focused
                        ? "border-[var(--oke-accent)] text-[var(--oke-fg)]"
                        : "border-[var(--oke-line)] text-[var(--oke-muted)]",
                    )}
                    onClick={() => setSearch(focusNode(search, n.id))}
                  >
                    <span>{n.label}</span>
                    {n.kind === "unit" && n.flowCount !== undefined ? (
                      <span className="font-mono text-xs">
                        {n.flowCount}
                      </span>
                    ) : null}
                    {!n.insideBoundary ? (
                      <span className="text-xs text-[var(--oke-external)]">
                        external
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
            <ul className="sr-only" aria-label="Edges">
              {view.edges.map((e) => (
                <li key={e.id}>
                  {e.from} → {e.to}
                  {e.dashed
                    ? " (declared, never traversed)"
                    : ` · ${e.traversals} traversals`}
                  {` · ${e.layer}`}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside
          aria-label="Findings"
          className="w-full shrink-0 overflow-auto border-t border-[var(--oke-line)] lg:w-80 lg:border-l lg:border-t-0"
        >
          <div className="px-5 py-4">
            <h2 className="text-sm font-medium">Findings</h2>
            <p className="mt-1 text-xs text-[var(--oke-muted)]">
              Pathologies from the graph as data
            </p>
          </div>
          {view.findings.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-[var(--oke-muted)]">
              No pathologies detected.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--oke-line)] border-t border-[var(--oke-line)]">
              {view.findings.map((f, i) => (
                <li key={`${f.kind}-${i}`} className="px-5 py-3">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span
                      className={clsx(
                        "inline-block size-1.5 rounded-full",
                        f.severity === "critical"
                          ? "bg-[var(--oke-danger)]"
                          : "bg-[var(--oke-external)]",
                      )}
                      aria-hidden
                    />
                    {f.title}
                  </p>
                  <p className="mt-1 text-sm text-[var(--oke-muted)]">
                    {f.detail}
                  </p>
                  {f.nodeIds[0] ? (
                    <button
                      type="button"
                      className="mt-2 min-h-8 text-sm text-[var(--oke-accent)] underline-offset-2 hover:underline"
                      onClick={() =>
                        setSearch(focusNode(search, f.nodeIds[0]!))
                      }
                    >
                      Focus
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function truncate(label: string, max: number): string {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}
