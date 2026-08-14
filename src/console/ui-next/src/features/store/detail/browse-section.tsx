/**
 * Browse section — SACP-style toolbar + virtualized grid.
 */

import { useMemo, useState, type JSX } from "react";
import {
  Alert02Icon,
  ArrowReloadHorizontalIcon,
  FunctionIcon,
  Key01Icon,
  PencilEdit01Icon,
  PlusSignIcon,
  PuzzleIcon,
  SecurityCheckIcon,
  UnfoldMoreIcon,
  UserIcon,
  ViewIcon,
  ZapIcon,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select.tsx";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStoreDelete } from "../data/use-store-edit.ts";
import { useStoreQuery } from "../data/use-store-query.ts";
import { ExtensionLibrarySheet } from "../grid/extension-library-sheet.tsx";
import { RlsPolicySheet } from "../grid/rls-policy-sheet.tsx";
import { SqlFunctionSheet } from "../grid/sql-function-sheet.tsx";
import { SqlIndexSheet } from "../grid/sql-index-sheet.tsx";
import { SqlTriggerSheet } from "../grid/sql-trigger-sheet.tsx";
import { StoreConfirmSheet } from "../grid/store-confirm-sheet.tsx";
import { FileExplorer } from "../files/file-explorer.tsx";
import { StoreDataGrid } from "../grid/store-data-grid.tsx";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { buildStoreGridModel, type StoreGridRow } from "../lib/grid-model.ts";
import { parseIndexQuery } from "../lib/index-query.ts";
import { childCatalogKind, groupSqlChildren, isSqlCatalogChild } from "../lib/sql-catalog.ts";
import { TouchedByLists } from "./touched-by-section.tsx";

/** Browse page sizes offered in the Rows select. */
const BROWSE_LIMITS = [10, 25, 50, 100, 250, 500] as const;

/** Props for {@link BrowseSection}. */
export interface BrowseSectionProps {
  readonly store: StoreListStore;
  readonly child: StoreListChild;
  readonly manifest: import("../../../../../../manifest/types.ts").Manifest | null;
  readonly tenancyDeclared: boolean;
  readonly tenants: readonly string[];
  readonly tenant: string | null;
  readonly onTenantChange: (tenant: string | null) => void;
  /** When false, SQL browse requests audited PII cleartext for every classified column. */
  readonly piiMasked?: boolean;
}

/**
 * Resource browser with SACP toolbar, grid, and typed-confirm delete.
 *
 * @param props - Selection + Manifest + tenancy + PII mask toggle
 */
export function BrowseSection({
  store,
  child,
  manifest,
  tenancyDeclared,
  tenants,
  tenant,
  onTenantChange,
  piiMasked = true,
}: BrowseSectionProps): JSX.Element {
  const [limit, setLimit] = useState(500);
  const [indexText, setIndexText] = useState("");
  const [topK, setTopK] = useState(5);
  const [deleting, setDeleting] = useState<readonly StoreGridRow[] | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [functionOpen, setFunctionOpen] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);

  const indexQuery = useMemo(() => parseIndexQuery(indexText), [indexText]);
  const tenantReady = !tenancyDeclared || (tenant !== null && tenant.length > 0);

  const queryInput = useMemo(() => {
    if (!tenantReady) return null;
    return {
      ref: store.ref,
      child: child.name,
      ...(tenant ? { tenant } : {}),
      limit,
      ...(store.facet === "index" && indexQuery.kind === "vector"
        ? { vector: indexQuery.vector, topK }
        : {}),
      ...(store.facet === "index" && indexQuery.kind === "text" ? { q: indexQuery.q, topK } : {}),
      ...(store.facet === "sql" && !piiMasked ? { revealPii: true } : {}),
    };
  }, [store.ref, store.facet, child.name, tenant, tenantReady, limit, indexQuery, topK, piiMasked]);

  const browse = useStoreQuery(queryInput, tenantReady);
  const deleteMutation = useStoreDelete();
  const catalogKind = childCatalogKind(child);
  const extensionCatalog = catalogKind === "extension";
  const policyCatalog = catalogKind === "policy";
  const functionCatalog = catalogKind === "function";
  const indexCatalog = catalogKind === "index";
  const triggerCatalog = catalogKind === "trigger";
  const catalogReadOnly = isSqlCatalogChild(child) && !extensionCatalog;
  const authReadOnly = store.ref === "sql:oke_console" || catalogReadOnly;

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
    if (Object.keys(types).length === 0) {
      for (const key of Object.keys(child.columnDescriptions)) {
        types[key] = "text";
      }
    }
    if (pks.length === 0 && "id" in types) pks.push("id");
    return { columnTypes: types, primaryKeyColumns: pks };
  }, [manifest, store.name, child]);

  const model = useMemo(() => {
    if (!browse.data) return null;
    const built = buildStoreGridModel({
      facet: store.facet,
      data: browse.data,
      piiColumns: child.piiColumns,
      columnTypes,
      columnDescriptions: child.columnDescriptions,
      primaryKeyColumns,
    });
    if (policyCatalog && store.ref !== "sql:oke_console") {
      return {
        ...built,
        editable: true,
        columns: built.columns
          .filter((c) => c.key !== "id" && c.key !== "schema")
          .map((c) => ({
            ...c,
            editable:
              c.key === "roles" ||
              c.key === "using" ||
              c.key === "with_check" ||
              c.key === "command" ||
              c.key === "permissive",
          })),
      };
    }
    if (policyCatalog) {
      return {
        ...built,
        editable: false,
        columns: built.columns
          .filter((c) => c.key !== "id" && c.key !== "schema")
          .map((c) => ({ ...c, editable: false })),
      };
    }
    if (extensionCatalog && store.ref !== "sql:oke_console") {
      return {
        ...built,
        editable: true,
        columns: built.columns
          .filter(
            (c) =>
              c.key !== "name" &&
              c.key !== "version" &&
              c.key !== "available" &&
              c.key !== "upgrade" &&
              c.key !== "url",
          )
          .map((c) => ({
            ...c,
            type: c.key === "enabled" ? ("boolean" as const) : c.type,
            editable: c.key === "enabled",
            ...(c.key === "title" ? { label: "Name", format: "name-key" as const } : {}),
            ...(c.key === "source" ? { label: "Source", format: "source" as const } : {}),
          })),
      };
    }
    if (!authReadOnly) return built;
    return {
      ...built,
      editable: false,
      columns: built.columns.map((c) => ({ ...c, editable: false })),
    };
  }, [
    browse.data,
    store.facet,
    store.ref,
    child,
    columnTypes,
    primaryKeyColumns,
    authReadOnly,
    extensionCatalog,
    policyCatalog,
  ]);

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
        },
      },
    );
  };

  const writerCount = new Set(child.writers).size;
  const readerCount = new Set(child.readers).size;
  const showToolbar = tenantReady && model !== null;

  const toolbarExtras = (
    <>
      <Tooltip>
        <TooltipTrigger
          render={(props) => (
            <Button
              {...props}
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => void browse.refetch()}
              disabled={browse.isFetching}
              aria-label="Refresh"
              data-slot="browse-refresh"
            >
              <HugeiconsIcon
                icon={ArrowReloadHorizontalIcon}
                className={browse.isFetching ? "size-3.5 animate-spin" : "size-3.5"}
                aria-hidden
              />
            </Button>
          )}
        />
        <TooltipContent side="bottom" className="text-[11px]">
          Reload from the store
        </TooltipContent>
      </Tooltip>

      {store.facet === "sql" && !authReadOnly && !isSqlCatalogChild(child) ? (
        <ToolbarTip label="Insert a row">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            data-slot="add-sql-row"
            onClick={() => setInsertOpen(true)}
          >
            <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" aria-hidden />
            Insert data
          </Button>
        </ToolbarTip>
      ) : null}

      {indexCatalog && store.ref !== "sql:oke_console" ? (
        <ToolbarTip label="CREATE INDEX">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            data-slot="sql-create-index"
            onClick={() => setIndexOpen(true)}
          >
            <HugeiconsIcon icon={Key01Icon} className="size-3.5" aria-hidden />
            Create index
          </Button>
        </ToolbarTip>
      ) : null}

      {functionCatalog && store.ref !== "sql:oke_console" ? (
        <ToolbarTip label="CREATE FUNCTION">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            data-slot="sql-create-function"
            onClick={() => setFunctionOpen(true)}
          >
            <HugeiconsIcon icon={FunctionIcon} className="size-3.5" aria-hidden />
            New function
          </Button>
        </ToolbarTip>
      ) : null}

      {triggerCatalog && store.ref !== "sql:oke_console" ? (
        <ToolbarTip label="CREATE TRIGGER">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            data-slot="sql-create-trigger"
            onClick={() => setTriggerOpen(true)}
          >
            <HugeiconsIcon icon={ZapIcon} className="size-3.5" aria-hidden />
            New trigger
          </Button>
        </ToolbarTip>
      ) : null}

      {policyCatalog && store.ref !== "sql:oke_console" ? (
        <ToolbarTip label="CREATE POLICY on a table">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            data-slot="rls-create-policy"
            onClick={() => setPolicyOpen(true)}
          >
            <HugeiconsIcon icon={SecurityCheckIcon} className="size-3.5" aria-hidden />
            Create policy
          </Button>
        </ToolbarTip>
      ) : null}

      {extensionCatalog && store.ref !== "sql:oke_console" ? (
        <ToolbarTip label="Add Timescale, PostGIS, pg_cron…">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            data-slot="extension-library"
            onClick={() => setLibraryOpen(true)}
          >
            <HugeiconsIcon icon={PuzzleIcon} className="size-3.5" aria-hidden />
            Library
          </Button>
        </ToolbarTip>
      ) : null}

      <DropdownMenu>
        <ToolbarTip
          label={`${writerCount} writer${writerCount === 1 ? "" : "s"} · ${readerCount} reader${readerCount === 1 ? "" : "s"}`}
        >
          <DropdownMenuTrigger
            render={(props) => (
              <Button
                {...props}
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1.5 px-1.5 text-[11px] text-muted-foreground"
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
        </ToolbarTip>
        <DropdownMenuContent align="start" className="w-72 p-3">
          <TouchedByLists child={child} />
        </DropdownMenuContent>
      </DropdownMenu>

      {tenancyDeclared ? (
        <ToolbarTip label="Tenant for this browse">
          <div className="relative flex items-center">
            <HugeiconsIcon
              icon={UserIcon}
              className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground"
              aria-hidden
            />
            <select
              aria-label="Tenant"
              data-slot="store-tenant"
              className="h-6 min-w-[9rem] appearance-none rounded-md border border-border/70 bg-transparent pr-6 pl-7 font-mono text-[11px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
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
        </ToolbarTip>
      ) : null}

      <ToolbarTip label="Rows to fetch">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-muted-foreground">Rows</span>
          <Select
            value={String(limit)}
            onValueChange={(next) => {
              const n = Number(next);
              if (Number.isFinite(n)) setLimit(n);
            }}
            className="z-30 w-14"
          >
            <SelectTrigger
              aria-label="Browse limit"
              className="h-6 gap-0.5 border-0 bg-transparent px-1.5 py-0 text-[11px] tabular-nums shadow-none hover:border-transparent hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-16">
              {BROWSE_LIMITS.map((n) => (
                <SelectItem key={n} value={String(n)} className="text-[11px] tabular-nums">
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ToolbarTip>
    </>
  );

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-slot="browse-section"
      aria-label="Browse"
    >
      {store.facet === "sql" && browse.data?.masked ? (
        <p className="sr-only" role="status" data-slot="browse-mask-note">
          PII columns masked. Toggle the PII chip to show all cleartext, or reveal a cell. Editing a
          masked cell requires reveal first.
        </p>
      ) : null}
      {store.facet === "sql" &&
      browse.data &&
      !browse.data.masked &&
      child.piiColumns.length > 0 ? (
        <p className="sr-only" role="status" data-slot="browse-unmask-note">
          PII columns visible. Toggle the PII chip to remask.
        </p>
      ) : null}

      {store.facet === "kv" || store.facet === "files" || store.facet === "index" ? (
        <p className="sr-only" role="status" data-slot="browse-non-sql-pii">
          Not PII-classified — values are shown as returned by the store.
        </p>
      ) : null}

      {store.facet === "index" ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/60 px-3 py-2">
          <label className="flex min-w-[14rem] flex-1 items-center gap-2">
            <span className="shrink-0 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              Search
            </span>
            <Input
              aria-label="Search this index"
              className="h-7 border-border/60 bg-transparent text-[11px] shadow-none"
              placeholder="Find by title or id — or paste 1, 0, 0"
              value={indexText}
              onChange={(e) => setIndexText(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              topK
            </span>
            <Input
              type="number"
              min={1}
              max={100}
              aria-label="topK"
              className="h-7 w-16 border-border/60 bg-transparent font-mono text-[11px] tabular-nums shadow-none"
              value={topK}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1 && n <= 100) setTopK(n);
              }}
            />
          </label>
        </div>
      ) : null}

      {!tenantReady ? (
        <BrowseGate>
          <Empty role="status" data-slot="browse-gate">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={UserIcon} aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Select a tenant</EmptyTitle>
              <EmptyDescription>
                Tenancy is a compliance boundary, not a display filter — choose a tenant to browse
                its data.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </BrowseGate>
      ) : browse.isLoading ? (
        <BrowseSkeleton />
      ) : browse.isError ? (
        <BrowseGate>
          <Empty role="alert" data-slot="browse-error">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
                <HugeiconsIcon icon={Alert02Icon} aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Couldn’t load rows</EmptyTitle>
              <EmptyDescription>{browse.error.message}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </BrowseGate>
      ) : store.facet === "files" && browse.data ? (
        <div className="min-h-0 flex-1">
          <FileExplorer
            store={store}
            child={child}
            tenant={tenant}
            data={browse.data}
            fetching={browse.isFetching}
            onRefresh={() => void browse.refetch()}
          />
        </div>
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
            insertOpen={insertOpen}
            onInsertOpenChange={setInsertOpen}
            onDeleteRows={
              authReadOnly || extensionCatalog ? undefined : (rows) => setDeleting(rows)
            }
          />
        </div>
      ) : null}

      {extensionCatalog && store.ref !== "sql:oke_console" ? (
        <ExtensionLibrarySheet
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          storeRef={store.ref}
          presentNames={(model?.rows ?? []).map((row) => row.id)}
        />
      ) : null}

      {indexCatalog && store.ref !== "sql:oke_console" ? (
        <SqlIndexSheet
          open={indexOpen}
          onOpenChange={setIndexOpen}
          storeRef={store.ref}
          tables={groupSqlChildren(store.children).tables.map((row) => row.name)}
        />
      ) : null}

      {functionCatalog && store.ref !== "sql:oke_console" ? (
        <SqlFunctionSheet open={functionOpen} onOpenChange={setFunctionOpen} storeRef={store.ref} />
      ) : null}

      {triggerCatalog && store.ref !== "sql:oke_console" ? (
        <SqlTriggerSheet
          open={triggerOpen}
          onOpenChange={setTriggerOpen}
          storeRef={store.ref}
          tables={groupSqlChildren(store.children).tables.map((row) => row.name)}
        />
      ) : null}

      {policyCatalog && store.ref !== "sql:oke_console" ? (
        <RlsPolicySheet
          open={policyOpen}
          onOpenChange={setPolicyOpen}
          storeRef={store.ref}
          tables={groupSqlChildren(store.children).tables.map((row) => row.name)}
          manifest={manifest}
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

function BrowseGate({ children }: { readonly children: JSX.Element }): JSX.Element {
  return <div className="flex min-h-0 flex-1 items-center justify-center px-6">{children}</div>;
}

/**
 * Spreadsheet-shaped loading placeholder so the work surface doesn't jump.
 */
function BrowseSkeleton(): JSX.Element {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      role="status"
      data-slot="browse-loading"
      aria-label="Loading rows"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        <Skeleton className="h-5 w-8" />
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-14" />
        <Skeleton className="ml-auto h-5 w-48" />
        <Skeleton className="h-5 w-6" />
        <Skeleton className="h-5 w-6" />
      </div>
      <div className="flex h-8 shrink-0 items-center gap-6 border-b border-border/50 px-3">
        <Skeleton className="size-3.5" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {Array.from({ length: 14 }, (_, i) => (
          <div
            key={i}
            className="flex h-8 items-center gap-6 border-b border-border/30 px-3"
            style={{ opacity: 1 - i * 0.05 }}
          >
            <Skeleton className="size-3.5" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
