/**
 * Schema rail — tables / namespaces with columns from the Manifest.
 */

import { useMemo, useState, type JSX } from "react";
import { ArrowDown01Icon, ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Manifest } from "../../../../../../manifest/types.ts";
import type { StoreListChild, StoreListStore } from "@/client.ts";
import {
  EXPLORER_ICON_BUTTON_BARE_CLASS,
  EXPLORER_ICON_BUTTON_CLASS,
  EXPLORER_STRIP_CLASS,
  SECTION_HEAD_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { cn } from "@/lib/utils.ts";
import { useStoreQuery } from "../data/use-store-query.ts";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import {
  fieldsFromKvValues,
  querySchemaTables,
  schemaColumnsForChild,
  type QuerySchemaColumn,
} from "../lib/query-schema.ts";
import { SchemaColumnMarks } from "../schema/schema-constraint-icon.tsx";
import type { StoreQueryFacet } from "../state/store-selection.ts";

/** Props for {@link QuerySchemaPanel}. */
export interface QuerySchemaPanelProps {
  readonly store: StoreListStore | null | undefined;
  readonly facet: StoreQueryFacet;
  readonly manifest: Manifest | null;
  readonly onPickTable: (name: string) => void;
  readonly onPickColumn: (table: string, column: string) => void;
  readonly onCollapse?: () => void;
  readonly tenant?: string | null;
  readonly tenancyDeclared?: boolean;
}

/**
 * Right-rail schema browser for the query console.
 *
 * @param props - Store + Manifest + insert callbacks
 */
export function QuerySchemaPanel({
  store,
  facet,
  manifest,
  onPickTable,
  onPickColumn,
  onCollapse,
  tenant = null,
  tenancyDeclared = false,
}: QuerySchemaPanelProps): JSX.Element {
  const children = store?.children ?? [];
  const isSql = facet === "sql";
  const sqlCatalog = useMemo(() => querySchemaTables(store, manifest), [store, manifest]);

  return (
    <aside
      className="flex h-full min-h-0 w-56 shrink-0 flex-col overflow-hidden border-l border-border/60"
      data-slot="store-query-schema-panel"
    >
      <header className={cn(EXPLORER_STRIP_CLASS, "justify-between px-2")}>
        <p className={cn(SECTION_HEAD_CLASS, "min-w-0 truncate font-mono")}>
          {isSql ? "Schema" : "Namespaces"}
        </p>
        {onCollapse ? (
          <ToolbarTip label="Collapse schema" className="flex self-stretch">
            <button
              type="button"
              aria-label="Collapse schema"
              data-slot="store-query-schema-collapse"
              onClick={onCollapse}
              className={EXPLORER_ICON_BUTTON_CLASS}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" />
            </button>
          </ToolbarTip>
        ) : null}
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {children.length === 0 ? (
          <li className="px-2 py-4 text-[11px] text-muted-foreground">No resources.</li>
        ) : (
          children.map((child) => (
            <SchemaChild
              key={child.effectRef}
              store={store}
              child={child}
              facet={facet}
              manifest={manifest}
              sqlColumns={sqlCatalog.find((table) => table.name === child.name)?.columns}
              onPickTable={onPickTable}
              onPickColumn={onPickColumn}
              tenant={tenant}
              tenancyDeclared={tenancyDeclared}
            />
          ))
        )}
      </ul>
    </aside>
  );
}

function SchemaChild({
  store,
  child,
  facet,
  manifest,
  sqlColumns,
  onPickTable,
  onPickColumn,
  tenant,
  tenancyDeclared,
}: {
  readonly store: StoreListStore | null | undefined;
  readonly child: StoreListChild;
  readonly facet: StoreQueryFacet;
  readonly manifest: Manifest | null;
  readonly sqlColumns?: readonly QuerySchemaColumn[];
  readonly onPickTable: (name: string) => void;
  readonly onPickColumn: (table: string, column: string) => void;
  readonly tenant: string | null;
  readonly tenancyDeclared: boolean;
}): JSX.Element {
  const isSql = facet === "sql";
  const [open, setOpen] = useState(true);
  const columns = sqlColumns ?? schemaColumnsForChild(store, child, manifest);
  const expandable = isSql ? columns.length > 0 : true;

  return (
    <li>
      <div className="flex items-center">
        {expandable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${child.name}`}
            onClick={() => setOpen((v) => !v)}
            className={EXPLORER_ICON_BUTTON_BARE_CLASS}
          >
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              className={cn("size-3 transition-transform", !open && "-rotate-90")}
            />
          </button>
        ) : (
          <span className="size-6" />
        )}
        <button
          type="button"
          onClick={() => onPickTable(child.name)}
          className="min-w-0 flex-1 truncate px-2 py-1.5 text-left font-mono text-[11px] text-foreground hover:bg-muted/50"
          title={isSql ? `SELECT * FROM "${child.name}"` : `list ${child.name}:`}
        >
          {child.name}
        </button>
      </div>
      {isSql && open && columns.length > 0 ? (
        <ul className="border-l border-border/60 ml-3">
          {columns.map((col) => (
            <li key={col.name}>
              <button
                type="button"
                onClick={() => onPickColumn(child.name, col.name)}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-muted/50"
              >
                <SchemaColumnMarks
                  primaryKey={col.primaryKey}
                  foreignKey={"references" in col && col.references !== undefined}
                  unique={"unique" in col ? col.unique : undefined}
                  inferred={"inferredRef" in col ? col.inferredRef : undefined}
                />
                <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                  {col.name}
                </span>
                {"references" in col && col.references?.table ? (
                  <span className="max-w-[4rem] shrink-0 truncate font-mono text-[8px] text-muted-foreground">
                    → {col.references.table}
                  </span>
                ) : null}
                <span className="shrink-0 font-mono text-[9px] tracking-wide text-muted-foreground/70 uppercase">
                  {col.type === "unknown" ? "" : col.type}
                </span>
                {col.pii ? (
                  <span className="shrink-0 rounded border border-sky-500/30 px-1 text-[8px] text-sky-700 dark:text-sky-400">
                    PII
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!isSql && open && store ? (
        <KvFieldList
          store={store}
          namespace={child.name}
          tenant={tenant}
          tenancyDeclared={tenancyDeclared}
          onPickField={(field) => onPickColumn(child.name, field)}
        />
      ) : null}
    </li>
  );
}

function KvFieldList({
  store,
  namespace,
  tenant,
  tenancyDeclared,
  onPickField,
}: {
  readonly store: StoreListStore;
  readonly namespace: string;
  readonly tenant: string | null;
  readonly tenancyDeclared: boolean;
  readonly onPickField: (field: string) => void;
}): JSX.Element {
  const tenantReady = !tenancyDeclared || (tenant !== null && tenant.length > 0);
  const browse = useStoreQuery(
    {
      ref: store.ref,
      child: namespace,
      prefix: `${namespace}:`,
      limit: 40,
      ...(tenant ? { tenant } : {}),
    },
    tenantReady,
  );
  const fields = fieldsFromKvValues((browse.data?.keys ?? []).map((entry) => entry.value));

  return (
    <ul className="ml-3 border-l border-border/60">
      {!tenantReady ? (
        <li className="px-1.5 py-1 font-mono text-[10px] text-muted-foreground">
          Select a tenant.
        </li>
      ) : browse.isPending ? (
        <li className="px-1.5 py-1 font-mono text-[10px] text-muted-foreground">Loading…</li>
      ) : browse.isError ? (
        <li className="px-1.5 py-1 font-mono text-[10px] text-destructive">
          Couldn’t read fields.
        </li>
      ) : fields.length === 0 ? (
        <li className="px-1.5 py-1 font-mono text-[10px] text-muted-foreground">No fields.</li>
      ) : (
        fields.map((field) => (
          <li key={field.name}>
            <button
              type="button"
              onClick={() => onPickField(field.name)}
              className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-muted/50"
            >
              <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                {field.name}
              </span>
              <span className="shrink-0 font-mono text-[9px] tracking-wide text-muted-foreground/70 uppercase">
                {field.type === "unknown" ? "" : field.type}
              </span>
            </button>
          </li>
        ))
      )}
    </ul>
  );
}

/**
 * Thin right-edge strip when the schema rail is collapsed.
 *
 * @param props - Expand + facet label
 */
export function QuerySchemaCollapsed({
  facet,
  onExpand,
}: {
  readonly facet: StoreQueryFacet;
  readonly onExpand: () => void;
}): JSX.Element {
  const label = facet === "sql" ? "Schema" : "Fields";
  return (
    <ToolbarTip label={`Expand ${label.toLowerCase()}`} className="h-full">
      <button
        type="button"
        aria-label={`Expand ${label.toLowerCase()}`}
        data-slot="store-query-schema-expand"
        onClick={onExpand}
        className="flex h-full w-7 shrink-0 flex-col items-center gap-2 border-l border-border/60 py-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} className="size-3.5" />
        <span className="font-mono text-[10px] font-semibold tracking-[0.08em] uppercase [writing-mode:vertical-rl]">
          {label}
        </span>
      </button>
    </ToolbarTip>
  );
}
