/**
 * Flows panel — three-column causality view (console §9.1 · §9.2).
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import {
  buildCausalityGraph,
  centreFlows,
  leftCauses,
  rightEffects,
  type CauseNode,
  type EffectNode,
  type FlowNode,
} from "../../../flows/graph.ts";
import {
  closeDrawer,
  openDrawer,
  parsePath,
  selectCause,
  selectEffect,
  selectFlow,
  serializeFlowsSearch,
  type FlowsSearch,
} from "../../../flows/search.ts";
import { TIER_LABEL, TIER_ORDER, type UiEffectTier } from "../../../flows/tiers.ts";
import type { Manifest } from "../../../../../manifest/types.ts";
import { consoleCalls } from "../../client.ts";
import { Button, Input, NewRowsPill } from "../../components/ui.tsx";
import { Dim } from "./ContractEditor.tsx";
import { FlowDrawer } from "./FlowDrawer.tsx";

/**
 * Flows causality panel. Traversal state lives entirely in URL search params.
 */
export function FlowsPanel() {
  const search = useSearch({ from: "/flows" }) as FlowsSearch;
  const navigate = useNavigate({ from: "/flows" });

  const setSearch = (next: FlowsSearch) => {
    void navigate({
      search: serializeFlowsSearch(next) as never,
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

  const graph = useMemo(() => buildCausalityGraph(manifestQuery.data), [manifestQuery.data]);

  const causes = useMemo(
    () =>
      leftCauses(graph, {
        sel: search.sel,
        flow: search.flow,
        effect: search.effect,
        q: search.q,
      }),
    [graph, search.sel, search.flow, search.effect, search.q],
  );

  const flows = useMemo(
    () =>
      centreFlows(graph, {
        sel: search.sel,
        cause: search.cause,
        flow: search.flow,
        effect: search.effect,
        q: search.q,
        unit: search.unit,
      }),
    [graph, search],
  );

  const effects = useMemo(
    () =>
      rightEffects(
        graph,
        {
          sel: search.sel,
          cause: search.cause,
          flow: search.flow,
          q: search.q,
        },
        { hideUbiquitous: search.hideUbiquitous },
      ),
    [graph, search],
  );

  const openFlow = search.open ? graph.flowById.get(search.open) : undefined;

  const path = parsePath(search.path);
  const [pendingNew] = useState(0);

  const groupedFlows = useMemo(() => {
    if (search.group === "alpha") {
      return [{ unit: "", rows: [...flows].sort((a, b) => a.id.localeCompare(b.id)) }];
    }
    const map = new Map<string, typeof flows>();
    for (const f of flows) {
      const list = map.get(f.unit) ?? [];
      list.push(f);
      map.set(f.unit, list);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([unit, rows]) => ({
        unit,
        rows: rows.sort((a, b) => a.action.localeCompare(b.action)),
      }));
  }, [flows, search.group]);

  const effectsByTier = useMemo(() => {
    const map = new Map<UiEffectTier, typeof effects>();
    for (const tier of TIER_ORDER) map.set(tier, []);
    for (const e of effects) {
      map.get(e.tier)?.push(e);
    }
    return map;
  }, [effects]);

  return (
    <div className="relative flex h-[calc(100vh-3rem)] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--oke-line)] px-4 py-2">
        <h1 className="text-sm font-semibold tracking-wide">Flows</h1>
        <p className="text-xs text-[var(--oke-muted)]">Causes ← Flows → Effects</p>
        <label className="ml-auto flex min-w-[12rem] flex-1 items-center gap-2 text-xs text-[var(--oke-muted)] md:max-w-xs">
          <span className="sr-only">Filter</span>
          <Input
            type="search"
            placeholder="Filter (dims, never hides)"
            value={search.q ?? ""}
            onChange={(e) => setSearch({ ...search, q: e.currentTarget.value || undefined })}
          />
        </label>
        <Button
          type="button"
          variant="ghost"
          aria-pressed={search.density === "compact"}
          onClick={() =>
            setSearch({
              ...search,
              density: search.density === "compact" ? "comfortable" : "compact",
            })
          }
        >
          {search.density === "compact" ? "Compact" : "Comfortable"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-pressed={search.transitive}
          onClick={() => setSearch({ ...search, transitive: !search.transitive })}
        >
          {search.transitive ? "Transitive" : "Direct"}
        </Button>
        <NewRowsPill count={pendingNew} onFlush={() => undefined} />
      </header>

      {path.length > 0 ? (
        <nav
          aria-label="Traversal path"
          className="flex flex-wrap gap-1 border-b border-[var(--oke-line)] px-4 py-1.5 text-xs"
        >
          {path.map((hop, i) => (
            <button
              key={`${hop}-${i}`}
              type="button"
              className="min-h-8 px-1 text-[var(--oke-muted)] hover:text-[var(--oke-fg)]"
              onClick={() => setSearch(selectEffect(search, hop))}
            >
              {hop}
              {i < path.length - 1 ? " /" : ""}
            </button>
          ))}
        </nav>
      ) : null}

      <div
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: "minmax(12rem,1fr) minmax(18rem,1.4fr) minmax(12rem,1fr)",
        }}
      >
        <Column title="Causes" label="Causes">
          <ul className="divide-y divide-[var(--oke-line)]">
            {causes.map((c) => (
              <li key={c.id}>
                <CauseRow
                  cause={c}
                  selected={search.cause === c.id}
                  density={search.density}
                  onSelect={() => setSearch(selectCause(search, c.id))}
                />
              </li>
            ))}
          </ul>
        </Column>

        <Column title="Flows" label="Flows" bordered>
          {groupedFlows.map((group) => (
            <div key={group.unit || "all"}>
              {group.unit ? (
                <p className="sticky top-0 bg-[var(--oke-bg)] px-3 py-1 text-[11px] uppercase tracking-wider text-[var(--oke-muted)]">
                  {group.unit}
                </p>
              ) : null}
              <ul className="divide-y divide-[var(--oke-line)]">
                {group.rows.map((f) => (
                  <li key={f.id}>
                    <FlowRow
                      flow={f}
                      selected={search.flow === f.id || search.open === f.id}
                      density={search.density}
                      onSelect={() => setSearch(selectFlow(search, f.id))}
                      onOpen={() => setSearch(openDrawer(search, f.id, "peek"))}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Column>

        <Column title="Effects" label="Effects">
          {search.sel === "none" ? (
            <p className="px-3 py-2 text-xs text-[var(--oke-muted)]">
              Idle inventory — ranked by how many flows touch each resource.
            </p>
          ) : null}
          {TIER_ORDER.map((tier) => {
            const rows = effectsByTier.get(tier) ?? [];
            if (rows.length === 0) return null;
            const isCap = tier === "capabilities";
            return (
              <div
                key={tier}
                className={isCap ? "mt-auto border-t border-[var(--oke-line)]" : undefined}
              >
                <p
                  className="px-3 py-1 text-[11px] uppercase tracking-wider"
                  style={
                    tier === "external"
                      ? { color: "var(--oke-external)" }
                      : { color: "var(--oke-muted)" }
                  }
                >
                  {TIER_LABEL[tier]}
                </p>
                <ul className="divide-y divide-[var(--oke-line)]">
                  {rows.map((e) => (
                    <li key={e.ref}>
                      <EffectRow
                        effect={e}
                        selected={search.effect === e.ref}
                        density={search.density}
                        onSelect={() => setSearch(selectEffect(search, e.ref))}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </Column>
      </div>

      {openFlow && search.drawer !== "closed" ? (
        <FlowDrawer
          flow={openFlow}
          mode={search.drawer === "workbench" ? "workbench" : "peek"}
          editorMode={search.editor}
          production={false}
          onEditorModeChange={(editor) => setSearch({ ...search, editor })}
          onModeChange={(drawer) => setSearch({ ...search, drawer })}
          onClose={() => setSearch(closeDrawer(search))}
        />
      ) : null}
    </div>
  );
}

function Column({
  title,
  label,
  bordered,
  children,
}: {
  readonly title: string;
  readonly label: string;
  readonly bordered?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={
        bordered
          ? "flex min-h-0 flex-col overflow-auto border-x border-[var(--oke-line)]"
          : "flex min-h-0 flex-col overflow-auto"
      }
    >
      <h2 className="sticky top-0 z-10 border-b border-[var(--oke-line)] bg-[var(--oke-bg)] px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--oke-muted)]">
        {title}
      </h2>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function CauseRow({
  cause,
  selected,
  density,
  onSelect,
}: {
  readonly cause: CauseNode & { match: boolean };
  readonly selected: boolean;
  readonly density: FlowsSearch["density"];
  readonly onSelect: () => void;
}) {
  return (
    <Dim match={cause.match}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={
          density === "compact"
            ? "flex min-h-8 w-full items-center gap-2 px-3 text-left text-sm"
            : "flex min-h-10 w-full flex-col items-start justify-center gap-0.5 px-3 text-left text-sm"
        }
        style={
          selected
            ? { background: "color-mix(in oklab, var(--oke-fg) 8%, transparent)" }
            : undefined
        }
      >
        <span className="font-mono text-[13px]">{cause.label}</span>
        {density === "comfortable" ? (
          <span className="text-[11px] text-[var(--oke-muted)]">{cause.kind}</span>
        ) : null}
      </button>
    </Dim>
  );
}

function FlowRow({
  flow,
  selected,
  density,
  onSelect,
  onOpen,
}: {
  readonly flow: FlowNode & { match: boolean };
  readonly selected: boolean;
  readonly density: FlowsSearch["density"];
  readonly onSelect: () => void;
  readonly onOpen: () => void;
}) {
  return (
    <Dim match={flow.match}>
      <div
        className={
          density === "compact"
            ? "flex min-h-8 items-center gap-2 px-2"
            : "flex min-h-10 items-center gap-2 px-2"
        }
        style={
          selected
            ? { background: "color-mix(in oklab, var(--oke-fg) 8%, transparent)" }
            : undefined
        }
      >
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="flex min-h-8 min-w-0 flex-1 items-center gap-2 text-left text-sm"
        >
          <StatusMark hollow />
          <span className="truncate">
            <span className="text-[var(--oke-muted)]">{flow.unit}.</span>
            {flow.action}
          </span>
          {flow.flags.external ? (
            <span
              className="font-mono text-[11px]"
              style={{ color: "var(--oke-external)" }}
              title="External effect"
            >
              ↗
            </span>
          ) : null}
          {flow.flags.durable ? <Tiny>D</Tiny> : null}
          {flow.flags.live ? <Tiny>L</Tiny> : null}
          {flow.flags.readsSecret ? <Tiny>S</Tiny> : null}
        </button>
        <Button type="button" variant="ghost" className="px-2" onClick={onOpen}>
          Open
        </Button>
      </div>
    </Dim>
  );
}

function EffectRow({
  effect,
  selected,
  density,
  onSelect,
}: {
  readonly effect: EffectNode & { match: boolean };
  readonly selected: boolean;
  readonly density: FlowsSearch["density"];
  readonly onSelect: () => void;
}) {
  const external = effect.tier === "external";
  return (
    <Dim match={effect.match}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={
          density === "compact"
            ? "flex min-h-8 w-full items-center gap-2 px-3 text-left text-sm"
            : "flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm"
        }
        style={
          selected
            ? { background: "color-mix(in oklab, var(--oke-fg) 8%, transparent)" }
            : undefined
        }
      >
        <span
          className="truncate font-mono text-[13px]"
          style={external ? { color: "var(--oke-external)" } : undefined}
        >
          {effect.ref}
        </span>
        {external ? (
          <span aria-hidden="true" style={{ color: "var(--oke-external)" }}>
            ↗
          </span>
        ) : null}
        {effect.touchCount > 1 ? (
          <span className="ml-auto text-[11px] text-[var(--oke-muted)]">{effect.touchCount}</span>
        ) : null}
        {effect.fanOut > 0 ? (
          <span className="text-[11px] text-[var(--oke-muted)]">×{effect.fanOut}</span>
        ) : null}
      </button>
    </Dim>
  );
}

function StatusMark({ hollow }: { readonly hollow?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 shrink-0 rounded-full border border-[var(--oke-muted)]"
      style={hollow ? undefined : { background: "var(--oke-accent)" }}
    />
  );
}

function Tiny({ children }: { readonly children: ReactNode }) {
  return (
    <span className="border border-[var(--oke-line)] px-1 font-mono text-[10px] text-[var(--oke-muted)]">
      {children}
    </span>
  );
}
