/**
 * Store page — read-first operator browse (facet tree + schema + browse + reveal).
 */

import { useMemo, type JSX } from "react";
import { ExplorerEmpty } from "@/components/explorer/explorer-empty.tsx";
import { ExplorerStartToggle } from "@/components/explorer/explorer-start-toggle.tsx";
import { EXPLORER_PAGE_CLASS, EXPLORER_SPLIT } from "@/components/explorer/explorer-chrome.ts";
import { useExplorerStartPanel } from "@/components/explorer/use-explorer-start-panel.ts";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { useConsoleLive } from "@/features/flows/data/use-console-live.ts";
import { useManifest } from "@/features/flows/data/use-manifest.ts";
import { useRuns } from "@/features/flows/data/use-runs.ts";
import { useStoresList } from "./data/use-stores-list.ts";
import { ResourcePanel } from "./detail/resource-panel.tsx";
import { StoreTree } from "./explorer/store-tree.tsx";
import { findByEffectRef, firstEffectRef } from "./lib/store-tree.ts";
import { PerformancePanel } from "./performance/performance-panel.tsx";
import { QueryConsole } from "./query/query-console.tsx";
import { SchemaVisualizer } from "./schema/schema-visualizer.tsx";
import { useStoreSelection } from "./state/store-selection.ts";

/**
 * Store explorer page (~28% tree / ~72% detail).
 */
export function StorePage(): JSX.Element {
  const list = useStoresList();
  const manifestQuery = useManifest();
  const runs = useRuns();
  useConsoleLive(true);
  const {
    selectedResource,
    selectedTenant,
    queryFacet,
    schemaView,
    performanceView,
    performanceFacet,
    setSelectedResource,
    setSelectedTenant,
    setQueryFacet,
    setSchemaView,
    setPerformanceView,
  } = useStoreSelection();
  const start = useExplorerStartPanel();
  const startToggle = (
    <ExplorerStartToggle
      open={start.open}
      onToggle={start.toggle}
      noun="store"
      controlsId="store-tree"
      dataSlot="store-tree-toggle"
    />
  );

  const stores = list.data?.stores ?? [];
  const effectRef = selectedResource ?? firstEffectRef(stores);
  const selection = useMemo(
    () => (effectRef ? findByEffectRef(stores, effectRef) : null),
    [stores, effectRef],
  );

  return (
    <div className={EXPLORER_PAGE_CLASS} data-slot="store-page">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel
          panelRef={start.panelRef}
          collapsible
          collapsedSize={0}
          defaultSize={EXPLORER_SPLIT.start.defaultSize}
          minSize={EXPLORER_SPLIT.start.minSize}
          onResize={start.onResize}
          className="min-h-0 overflow-hidden"
        >
          <div id="store-tree" className="h-full min-h-0 overflow-hidden" data-slot="store-tree">
            <StoreTree
              stores={stores}
              selectedEffectRef={effectRef}
              onSelect={(ref) => {
                setSelectedResource(ref, {
                  keepView: schemaView || performanceView,
                });
              }}
              queryFacet={queryFacet}
              schemaActive={schemaView}
              performanceActive={performanceView}
              performanceFacet={performanceFacet}
              onOpenQuery={(facet) => {
                setQueryFacet(queryFacet === facet ? null : facet);
              }}
              onOpenSchema={() => {
                setSchemaView(!schemaView);
              }}
              onOpenPerformance={(facet) => {
                const current = performanceFacet ?? "sql";
                if (performanceView && current === facet) {
                  setPerformanceView(false);
                } else {
                  setPerformanceView(true, facet);
                }
              }}
            />
          </div>
        </ResizablePanel>
        {start.open ? <ResizableHandle withHandle /> : null}
        <ResizablePanel
          defaultSize={EXPLORER_SPLIT.end.defaultSize}
          minSize={EXPLORER_SPLIT.end.minSize}
          className="min-h-0 overflow-hidden"
        >
          <div className="h-full min-h-0 overflow-hidden">
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              {schemaView ? (
                <SchemaVisualizer
                  stores={stores}
                  manifest={manifestQuery.data ?? null}
                  selectedEffectRef={effectRef}
                  onSelectTable={(ref) => setSelectedResource(ref, { keepView: true })}
                  leading={startToggle}
                />
              ) : performanceView ? (
                <PerformancePanel
                  stores={stores}
                  selectedEffectRef={effectRef}
                  tenant={selectedTenant}
                  facet={performanceFacet ?? "sql"}
                  leading={startToggle}
                />
              ) : queryFacet ? (
                <QueryConsole
                  key={queryFacet}
                  facet={queryFacet}
                  stores={stores}
                  selectedEffectRef={effectRef}
                  tenancyDeclared={list.data?.tenancyDeclared ?? false}
                  tenants={list.data?.tenants ?? []}
                  tenant={selectedTenant}
                  onTenantChange={setSelectedTenant}
                  manifest={manifestQuery.data ?? null}
                  leading={startToggle}
                />
              ) : selection ? (
                <ResourcePanel
                  store={selection.store}
                  child={selection.child}
                  manifest={manifestQuery.data ?? null}
                  tenancyDeclared={list.data?.tenancyDeclared ?? false}
                  tenants={list.data?.tenants ?? []}
                  tenant={selectedTenant}
                  onTenantChange={setSelectedTenant}
                  runs={runs.data ?? []}
                  leading={startToggle}
                />
              ) : (
                <ExplorerEmpty
                  leading={startToggle}
                  icon={ELEMENT_ICONS.store.icon}
                  title={
                    list.isLoading
                      ? "Loading stores…"
                      : list.isError
                        ? "Store unavailable"
                        : "Select a resource"
                  }
                  description={
                    list.isLoading
                      ? "Reading store catalogs."
                      : list.isError
                        ? list.error.message
                        : "Pick a table, namespace, bucket, or index from the tree."
                  }
                />
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
