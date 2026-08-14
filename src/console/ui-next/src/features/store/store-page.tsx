/**
 * Store page — read-first operator browse (facet tree + schema + browse + reveal).
 */

import { useMemo, type JSX } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
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
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden" data-slot="store-page">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="28%" minSize="18%" className="min-h-0 overflow-hidden">
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
        <ResizablePanel defaultSize="72%" minSize="40%" className="min-h-0 overflow-hidden">
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
                <div className="flex h-full items-center justify-center p-6">
                  <p className="text-sm text-muted-foreground">
                    {list.isLoading
                      ? "Loading stores…"
                      : list.isError
                        ? list.error.message
                        : "Select a resource from the Store tree."}
                  </p>
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
