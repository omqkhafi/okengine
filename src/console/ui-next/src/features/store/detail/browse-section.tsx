/**
 * Browse section — SACP-style toolbar + virtualized grid + row detail Sheet.
 */

import { useMemo, useState, type JSX } from "react";
import {
  Alert02Icon,
  ArrowReloadHorizontalIcon,
  PencilEdit01Icon,
  Search01Icon,
  SecurityCheckIcon,
  UnfoldMoreIcon,
  UserIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { StoreListChild, StoreListStore } from "@/client.ts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStoreDelete } from "../data/use-store-edit.ts";
import { useStoreQuery } from "../data/use-store-query.ts";
import { StoreConfirmSheet } from "../grid/store-confirm-sheet.tsx";
import { StoreDataGrid } from "../grid/store-data-grid.tsx";
import { StoreEditSheet } from "../grid/store-edit-sheet.tsx";
import { buildStoreGridModel, type StoreGridRow } from "../lib/grid-model.ts";
import { StoreRowDetailSheet } from "./store-row-detail-sheet.tsx";
import { TouchedByLists } from "./touched-by-section.tsx";

/** Props for {@link BrowseSection}. */
export interface BrowseSectionProps {
  readonly store: StoreListStore;
  readonly child: StoreListChild;
  readonly manifest: import("../../../../../../manifest/types.ts").Manifest | null;
  readonly tenancyDeclared: boolean;
  readonly tenants: readonly string[];
  readonly tenant: string | null;
  readonly onTenantChange: (tenant: string | null) => void;
}

/**
 * Resource browser with SACP toolbar, grid, row detail, and safe mutations.
 *
 * @param props - Selection + Manifest + tenancy controls
 */
export function BrowseSection({
  store,
  child,
  manifest,
  tenancyDeclared,
  tenants,
  tenant,
  onTenantChange,
}: BrowseSectionProps): JSX.Element {
  const [limit, setLimit] = useState(50);
  const [vectorText, setVectorText] = useState("");
  const [topK, setTopK] = useState(5);
  const [detail, setDetail] = useState<StoreGridRow | null>(null);
  const [editing, setEditing] = useState<StoreGridRow | null>(null);
  const [deleting, setDeleting] = useState<readonly StoreGridRow[] | null>(null);

  const vector = useMemo(() => parseVector(vectorText), [vectorText]);
  const tenantReady = !tenancyDeclared || (tenant !== null && tenant.length > 0);
  const indexReady = store.facet !== "index" || (vector !== null && vector.length > 0);

  const queryInput = useMemo(() => {
    if (!tenantReady) return null;
    return {
      ref: store.ref,
      child: child.name,
      ...(tenant ? { tenant } : {}),
      limit,
      ...(store.facet === "index" && vector ? { vector, topK } : {}),
    };
  }, [store.ref, store.facet, child.name, tenant, tenantReady, limit, vector, topK]);

  const browse = useStoreQuery(queryInput, tenantReady && (store.facet !== "index" || indexReady));
  const deleteMutation = useStoreDelete();

  const { columnTypes, primaryKeyColumns } = useMemo(() => {
    const table = manifest?.stores?.[store.name]?.tables?.[child.name];
    const types: Record<string, "text" | "integer"> = {};
    const pks: string[] = [];
    for (const [key, col] of Object.entries(table?.columns ?? {})) {
      if (col && typeof col === "object") {
        const t = (col as { type?: unknown }).type;
        if (t === "text" || t === "integer") types[key] = t;
        if ((col as { primaryKey?: unknown }).primaryKey === true) pks.push(key);
      }
    }
    return { columnTypes: types, primaryKeyColumns: pks };
  }, [manifest, store.name, child.name]);

  const model = useMemo(() => {
    if (!browse.data) return null;
    return buildStoreGridModel({
      facet: store.facet,
      data: browse.data,
      piiColumns: child.piiColumns,
      columnTypes,
      columnDescriptions: child.columnDescriptions,
      primaryKeyColumns,
    });
  }, [browse.data, store.facet, child, columnTypes, primaryKeyColumns]);

  // ui-next seed/dev runs with env "test"; the server enforces typed confirm in production.
  const production = false;

  const onDeleteConfirm = (input: { confirmation: string; reason: string }) => {
    if (!deleting) return;
    const ids = deleting.map((r) => r.id);
    deleteMutation.mutate(
      {
        ref: store.ref,
        ...(store.facet === "sql" ? { child: child.name } : {}),
        ...(tenant ? { tenant } : {}),
        ...(model?.deleteKind === "keys" ? { keys: ids } : { ids }),
        confirmation: input.confirmation,
        reason: input.reason,
      },
      {
        onSuccess: () => {
          setDeleting(null);
          setDetail(null);
        },
      },
    );
  };

  const writerCount = new Set(child.writers).size;
  const readerCount = new Set(child.readers).size;
  const showToolbar = tenantReady && (store.facet !== "index" || indexReady) && model !== null;

  const toolbarExtras = (
    <>
      <Tooltip>
        <TooltipTrigger
          render={(props) => (
            <Button
              {...props}
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              onClick={() => void browse.refetch()}
              disabled={browse.isFetching}
              data-slot="browse-refresh"
            >
              <HugeiconsIcon
                icon={ArrowReloadHorizontalIcon}
                className={browse.isFetching ? "size-3.5 animate-spin" : "size-3.5"}
                aria-hidden
              />
              Refresh
            </Button>
          )}
        />
        <TooltipContent side="bottom" className="text-[11px]">
          Reload from the store
        </TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={(props) => (
            <Button
              {...props}
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"
              data-slot="browse-touched-by"
              aria-label={`${writerCount} writers, ${readerCount} readers`}
            >
              <span className="flex items-center gap-1">
                <HugeiconsIcon icon={PencilEdit01Icon} className="size-3" aria-hidden />
                <span className="font-mono tabular-nums">{writerCount}</span>
              </span>
              <span aria-hidden className="h-3 w-px bg-border/60" />
              <span className="flex items-center gap-1">
                <HugeiconsIcon icon={ViewIcon} className="size-3" aria-hidden />
                <span className="font-mono tabular-nums">{readerCount}</span>
              </span>
            </Button>
          )}
        />
        <DropdownMenuContent align="start" className="w-72 p-3">
          <TouchedByLists child={child} />
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="h-4 w-px bg-border/60" aria-hidden />

      {tenancyDeclared ? (
        <div className="relative flex items-center">
          <HugeiconsIcon
            icon={UserIcon}
            className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground"
            aria-hidden
          />
          <select
            aria-label="Tenant"
            data-slot="store-tenant"
            className="h-7 min-w-[9rem] appearance-none rounded-md border border-border/70 bg-transparent pr-6 pl-7 font-mono text-[11px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            value={tenant ?? ""}
            onChange={(e) => onTenantChange(e.target.value.length > 0 ? e.target.value : null)}
          >
            <option value="">Select tenant…</option>
            {tenants.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <HugeiconsIcon
            icon={UnfoldMoreIcon}
            className="pointer-events-none absolute right-1.5 size-3.5 text-muted-foreground"
            aria-hidden
          />
        </div>
      ) : null}

      <label className="flex items-center gap-1.5 text-[11px]">
        <span className="text-muted-foreground">Rows</span>
        <Input
          type="number"
          min={1}
          max={500}
          aria-label="Browse limit"
          className="h-7 w-16 border-border/60 bg-transparent font-mono text-[11px] tabular-nums shadow-none"
          value={limit}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 1 && n <= 500) setLimit(n);
          }}
        />
      </label>
    </>
  );

  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-2"
      data-slot="browse-section"
      aria-label="Browse"
    >
      {store.facet === "index" ? (
        <div className="flex shrink-0 flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
            <span className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              Probe vector
            </span>
            <Input
              aria-label="Probe vector"
              className="h-8 border-border/60 bg-background font-mono text-[11px] shadow-none"
              placeholder="0.1, 0.2, 0.3 — comma-separated"
              value={vectorText}
              onChange={(e) => setVectorText(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              topK
            </span>
            <Input
              type="number"
              min={1}
              max={100}
              aria-label="topK"
              className="h-8 w-20 border-border/60 bg-background font-mono text-[11px] tabular-nums shadow-none"
              value={topK}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1 && n <= 100) setTopK(n);
              }}
            />
          </label>
        </div>
      ) : null}

      {store.facet === "sql" && browse.data?.masked ? (
        <div
          className="flex shrink-0 items-start gap-2 rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2"
          role="status"
          data-slot="browse-mask-note"
        >
          <HugeiconsIcon
            icon={SecurityCheckIcon}
            className="mt-px size-3.5 shrink-0 text-sky-600 dark:text-sky-400"
            aria-hidden
          />
          <p className="text-[11px] leading-relaxed text-sky-900 dark:text-sky-200">
            <span className="font-medium">PII columns masked.</span>{" "}
            <span className="text-sky-800/80 dark:text-sky-300/80">
              Use Reveal on a cell for an audited cleartext peek. Editing a masked cell requires
              reveal first.
            </span>
          </p>
        </div>
      ) : null}

      {store.facet === "kv" || store.facet === "files" || store.facet === "index" ? (
        <div
          className="flex shrink-0 items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2"
          role="status"
          data-slot="browse-non-sql-pii"
        >
          <HugeiconsIcon
            icon={Alert02Icon}
            className="mt-px size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Not PII-classified — values are shown as returned by the store. This facet has no
            SQL-grade column masking.
          </p>
        </div>
      ) : null}

      {!tenantReady ? (
        <Empty role="status" data-slot="browse-gate">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={UserIcon} aria-hidden />
            </EmptyMedia>
            <EmptyTitle>Select a tenant</EmptyTitle>
            <EmptyDescription>
              Tenancy is a compliance boundary, not a display filter — choose a tenant to browse its
              data.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : store.facet === "index" && !indexReady ? (
        <Empty role="status" data-slot="browse-gate">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Search01Icon} aria-hidden />
            </EmptyMedia>
            <EmptyTitle>Probe this index</EmptyTitle>
            <EmptyDescription>
              Enter a comma-separated vector above to find the nearest neighbors.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : browse.isLoading ? (
        <Empty role="status" data-slot="browse-loading">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon
                icon={ArrowReloadHorizontalIcon}
                className="animate-spin"
                aria-hidden
              />
            </EmptyMedia>
            <EmptyTitle>Loading rows…</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : browse.isError ? (
        <Empty role="alert" data-slot="browse-error">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
              <HugeiconsIcon icon={Alert02Icon} aria-hidden />
            </EmptyMedia>
            <EmptyTitle>Couldn’t load rows</EmptyTitle>
            <EmptyDescription>{browse.error.message}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : model ? (
        <div className="min-h-0 flex-1">
          <StoreDataGrid
            model={model}
            facet={store.facet}
            storeRef={store.ref}
            childName={child.name}
            tenant={tenant}
            masked={browse.data?.masked ?? false}
            routedRole={browse.data?.routedRole}
            limit={limit}
            toolbarExtras={showToolbar ? toolbarExtras : undefined}
            onOpenRow={(row) => setDetail(row)}
            onDeleteRows={(rows) => setDeleting(rows)}
          />
        </div>
      ) : null}

      <StoreRowDetailSheet
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        model={model ?? emptyModel}
        row={detail}
        facet={store.facet}
        storeRef={store.ref}
        childName={child.name}
        tenant={tenant}
        masked={browse.data?.masked ?? false}
        onEditRow={
          model?.editable && (store.facet === "sql" || store.facet === "kv")
            ? (row) => {
                setDetail(null);
                setEditing(row);
              }
            : undefined
        }
        onDeleteRow={(row) => {
          setDetail(null);
          setDeleting([row]);
        }}
      />

      {store.facet === "sql" || store.facet === "kv" ? (
        <StoreEditSheet
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          model={model ?? emptyModel}
          row={editing}
          facet={store.facet}
          storeRef={store.ref}
          childName={child.name}
          tenant={tenant}
          production={production}
        />
      ) : null}

      <StoreConfirmSheet
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        phrase="DELETE"
        title={`Delete ${deleting?.length ?? 0} ${deleting?.length === 1 ? "row" : "rows"}`}
        description={`Permanently delete ${deleting?.length ?? 0} item(s) from ${store.ref}${store.facet === "sql" ? `/${child.name}` : ""}. This is not a flow execution.`}
        pending={deleteMutation.isPending}
        error={deleteMutation.isError ? deleteMutation.error.message : null}
        onConfirm={onDeleteConfirm}
      />
    </section>
  );
}

const emptyModel = buildStoreGridModel({
  facet: "sql",
  data: { facet: "sql", rows: [], masked: false },
});

/**
 * Parse comma-separated numbers into a vector, or null when empty / invalid.
 *
 * @param text - Raw input
 */
export function parseVector(text: string): number[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[\s,]+/).filter((p) => p.length > 0);
  const nums: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  return nums.length > 0 ? nums : null;
}
