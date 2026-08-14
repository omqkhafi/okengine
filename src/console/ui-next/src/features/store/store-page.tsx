/**
 * Store page — read-first operator browse (facet tree + schema + browse + reveal).
 */

import { useMemo, type JSX } from "react";
import { ExplorerEmpty } from "@/components/explorer/explorer-empty.tsx";
import { EXPLORER_PAGE_CLASS, EXPLORER_SPLIT } from "@/components/explorer/explorer-chrome.ts";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { useConsoleLive } from "@/features/flows/data/use-console-live.ts";
import { useManifest } from "@/features/flows/data/use-manifest.ts";
import { useRuns } from "@/features/flows/data/use-runs.ts";
import { useStoresList } from "./data/use-stores-list.ts";
import { ResourcePanel } from "./detail/resource-panel.tsx";
import { StoreTree } from "./explorer/store-tree.tsx";
import { findByEffectRef, firstEffectRef } from "./lib/store-tree.ts";
import { QueryConsole } from "./query/query-console.tsx";
import { SchemaVisualizer } from "./schema/schema-visualizer.tsx";
import { useStoreSelection } from "./state/store-selection.ts";

/**
 * Store explorer page (Units layout: ~28% tree / ~72% detail).
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
    setSelectedResource,
    setSelectedTenant,
    setQueryFacet,
    setSchemaView,
  } = useStoreSelection();

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
          defaultSize={EXPLORER_SPLIT.start.defaultSize}
          minSize={EXPLORER_SPLIT.start.minSize}
          className="min-h-0 overflow-hidden"
        >
          <div className="h-full min-h-0 overflow-hidden">
            <StoreTree
              stores={stores}
              selectedEffectRef={effectRef}
              onSelect={(ref) => {
                setSelectedResource(ref);
              }}
              queryFacet={queryFacet}
              schemaActive={schemaView}
              onOpenQuery={(facet) => {
                setQueryFacet(queryFacet === facet ? null : facet);
              }}
              onOpenSchema={() => {
                setSchemaView(!schemaView);
              }}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
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
                />
              ) : (
                <ExplorerEmpty
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
