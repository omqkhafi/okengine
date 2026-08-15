/**
 * SQL / KV query console — tabs, saved queries, history, schema rail,
 * run current / selection / all, EXPLAIN, per-statement result sets.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert02Icon,
  ArrowDown01Icon,
  Cancel01Icon,
  Clock01Icon,
  Database01Icon,
  FloppyDiskIcon,
  Loading03Icon,
  PlayIcon,
  PlusSignIcon,
  SecurityCheckIcon,
  SourceCodeIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Manifest } from "../../../../../../manifest/types.ts";
import { storeDelete, storeEdit, storeQuery, type StoreListStore } from "@/client.ts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select.tsx";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils.ts";
import { STORE_QUERY_KEY } from "../data/use-store-query.ts";
import { useStoreSql } from "../data/use-store-sql.ts";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { formatKvTtl } from "../lib/kv-meta.ts";
import { kvSetPatch, parseKvQuery } from "../lib/kv-query.ts";
import {
  defaultKvQuery,
  defaultSqlQuery,
  firstChildName,
  isConsoleAuthStore,
  pickQueryStore,
} from "../lib/query-defaults.ts";
import {
  addQueryTab,
  closeQueryTab,
  historyPreview,
  isDefaultQueryTitle,
  loadQueryHistory,
  loadQueryTabs,
  loadSavedQueries,
  pushQueryHistory,
  renameQueryTab,
  saveQueryHistory,
  saveQueryTabs,
  saveSavedQueries,
  upsertSavedQuery,
  writeQueryTab,
  type QueryHistoryEntry,
  type QueryTab,
  type SavedQuery,
} from "../lib/query-session.ts";
import { prettifyKv } from "../lib/kv-format.ts";
import { prettifySql } from "../lib/sql-format.ts";
import { querySchemaTables } from "../lib/query-schema.ts";
import {
  isSqlWrite,
  isUnboundedSelect,
  splitSqlStatements,
  sqlBatchToRun,
  sqlStatementLabel,
  wrapExplain,
} from "../lib/sql-statements.ts";
import { STORE_FACET_SPECS } from "../lib/store-tree.ts";
import type { StoreQueryFacet } from "../state/store-selection.ts";
import { QueryEditor, type QueryEditorHandle } from "./query-editor.tsx";
import { QueryGateMenu } from "./query-gate-menu.tsx";
import { QueryResults, type QueryResultRow, type QueryResultSet } from "./query-results.tsx";
import { QuerySchemaCollapsed, QuerySchemaPanel } from "./query-schema-panel.tsx";

/** Props for {@link QueryConsole}. */
export interface QueryConsoleProps {
  readonly facet: StoreQueryFacet;
  readonly stores: readonly StoreListStore[];
  readonly selectedEffectRef: string | null;
  readonly tenancyDeclared: boolean;
  readonly tenants: readonly string[];
  readonly tenant: string | null;
  readonly onTenantChange: (tenant: string | null) => void;
  readonly manifest?: Manifest | null;
}

/**
 * Right-pane SQL / KV console opened from a facet band.
 *
 * @param props - Facet + stores + tenancy
 */
export function QueryConsole({
  facet,
  stores,
  selectedEffectRef,
  tenancyDeclared,
  tenants,
  tenant,
  onTenantChange,
  manifest = null,
}: QueryConsoleProps): JSX.Element {
  const spec = STORE_FACET_SPECS[facet];
  const ofFacet = useMemo(() => stores.filter((s) => s.facet === facet), [stores, facet]);
  const [storeRef, setStoreRef] = useState(
    () => pickQueryStore(stores, facet, selectedEffectRef)?.ref ?? ofFacet[0]?.ref ?? "",
  );
  const store = ofFacet.find((s) => s.ref === storeRef) ?? pickQueryStore(ofFacet, facet, null);
  const seed = seedEditor(store, facet, selectedEffectRef);

  const [tabs, setTabs] = useState<readonly QueryTab[]>(
    () => loadQueryTabs(facet) ?? [{ id: "q_1", title: "Query 1", text: seed }],
  );
  const [activeId, setActiveId] = useState(() => tabs[0]?.id ?? "q_1");
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const text = active?.text ?? seed;

  const [rows, setRows] = useState<readonly QueryResultRow[] | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [executed, setExecuted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kvPending, setKvPending] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [piiMasked, setPiiMasked] = useState(true);
  const [asGate, setAsGate] = useState<string | null>(null);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [history, setHistory] = useState<readonly QueryHistoryEntry[]>(() =>
    loadQueryHistory(facet),
  );
  const [saved, setSaved] = useState<readonly SavedQuery[]>(() => loadSavedQueries(facet));
  const [savedFlash, setSavedFlash] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [cursor, setCursor] = useState({ start: 0, end: 0 });
  const [sets, setSets] = useState<readonly QueryResultSet[]>([]);
  const [activeSet, setActiveSet] = useState(0);
  const [scriptPending, setScriptPending] = useState(false);
  const editorRef = useRef<QueryEditorHandle | null>(null);
  const pendingSaveRef = useRef(false);
  const savedFlashTimer = useRef<number | null>(null);

  const sql = useStoreSql();
  const queryClient = useQueryClient();
  const tenantReady = !tenancyDeclared || (tenant !== null && tenant.length > 0);
  const authLocked = store ? isConsoleAuthStore(store.ref) : false;
  const isSql = facet === "sql";
  const shortcut =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌘Enter" : "Ctrl+Enter";

  const schemaTables = useMemo(() => querySchemaTables(store, manifest), [store, manifest]);
  const statements = useMemo(() => (isSql ? splitSqlStatements(text) : []), [isSql, text]);
  const runLines = useMemo(() => statements.map((s) => s.startLine), [statements]);
  const selected = cursor.end !== cursor.start;
  const pendingBatch = useMemo(
    () => (isSql ? sqlBatchToRun(text, cursor.start, cursor.end, "current") : [text]),
    [cursor.end, cursor.start, isSql, text],
  );
  const unbounded = isSql && pendingBatch.some((stmt) => isUnboundedSelect(stmt));

  useEffect(() => {
    const next = pickQueryStore(stores, facet, selectedEffectRef);
    if (!next) return;
    setStoreRef((prev) => (ofFacet.some((s) => s.ref === prev) ? prev : next.ref));
  }, [stores, facet, selectedEffectRef, ofFacet]);

  useEffect(() => {
    saveQueryTabs(facet, tabs);
  }, [facet, tabs]);

  useEffect(() => {
    saveSavedQueries(facet, saved);
  }, [facet, saved]);

  useEffect(() => {
    return () => {
      if (savedFlashTimer.current !== null) window.clearTimeout(savedFlashTimer.current);
    };
  }, []);

  const setText = (next: string): void => {
    if (!active) return;
    setTabs((prev) => writeQueryTab(prev, active.id, next));
  };

  const record = (entry: Omit<QueryHistoryEntry, "id">): void => {
    setHistory((prev) => {
      const next = pushQueryHistory(prev, entry);
      saveQueryHistory(facet, next);
      return next;
    });
  };

  const finish = (options: {
    readonly sqlText: string;
    readonly nextRows: readonly QueryResultRow[] | null;
    readonly nextMeta: string | null;
    readonly nextError: string | null;
    readonly started: number;
  }): void => {
    const durationMs = Math.max(0, Date.now() - options.started);
    setSets([]);
    setActiveSet(0);
    setRows(options.nextRows);
    setMeta(options.nextMeta ? `${options.nextMeta} · ${durationMs}ms` : `${durationMs}ms`);
    setExecuted(options.sqlText);
    setError(options.nextError);
    record({
      at: Date.now(),
      storeRef: store?.ref ?? "",
      text: options.sqlText,
      ok: options.nextError === null,
      rowCount: options.nextRows?.length ?? null,
      durationMs,
      ...(options.nextError ? { error: options.nextError } : {}),
    });
  };

  const applySet = (next: readonly QueryResultSet[], index: number): void => {
    const set = next[index];
    setSets(next);
    setActiveSet(index);
    setRows(set?.rows ?? null);
    setError(set?.error ?? null);
    setMeta(set?.meta ?? null);
    setExecuted(set?.executed ?? next.map((row) => row.executed).join("\n") ?? null);
  };

  const runBatch = (texts: readonly string[], includePii = !piiMasked, gate = asGate): void => {
    if (!store) return;
    setResultsOpen(true);
    setError(null);
    if (!tenantReady) {
      setError("Select a tenant first.");
      return;
    }
    if (authLocked) {
      setError("oke_console is the operator-plane auth schema — read-only from Store browse.");
      return;
    }
    const batch = texts.map((stmt) => stmt.trim()).filter((stmt) => stmt.length > 0);
    if (batch.length === 0) {
      setError("Nothing to run.");
      return;
    }
    const started = Date.now();
    setScriptPending(true);
    setSets([]);
    setActiveSet(0);
    void (async () => {
      try {
        const nextSets: QueryResultSet[] = [];
        let anyWrite = false;
        for (const sqlText of batch) {
          const writing = isSqlWrite(sqlText);
          if (writing) anyWrite = true;
          try {
            const data = await sql.mutateAsync({
              ref: store.ref,
              sql: sqlText,
              ...(writing ? { allowWrite: true } : {}),
              ...(includePii ? { revealPii: true } : {}),
              ...(gate ? { asGate: gate } : {}),
              ...(tenant ? { tenant } : {}),
            });
            const changed = writeChanges(data.rows);
            const bits = [
              changed !== null
                ? `${changed} change${changed === 1 ? "" : "s"}`
                : `${data.rows.length} row${data.rows.length === 1 ? "" : "s"}`,
              `routed ${data.routedRole}`,
            ];
            if (data.masked) bits.push("PII masked");
            else if (includePii) bits.push("PII visible");
            if (data.asGate) {
              bits.push(data.gateApplied ? `as ${data.asGate}` : `as ${data.asGate} (not applied)`);
            }
            nextSets.push({
              label: sqlStatementLabel(sqlText),
              rows: data.rows,
              error: null,
              meta: bits.join(" · "),
              executed: sqlText,
            });
          } catch (err) {
            nextSets.push({
              label: sqlStatementLabel(sqlText),
              rows: null,
              error: err instanceof Error ? err.message : String(err),
              meta: null,
              executed: sqlText,
            });
            break;
          }
        }
        if (anyWrite) {
          void queryClient.invalidateQueries({ queryKey: STORE_QUERY_KEY });
        }
        const durationMs = Math.max(0, Date.now() - started);
        const last = nextSets[nextSets.length - 1];
        const joined = batch.join("\n");
        applySet(
          nextSets.map((set) => ({
            ...set,
            meta: set.meta ? `${set.meta} · ${durationMs}ms` : set.error ? null : `${durationMs}ms`,
          })),
          Math.max(0, nextSets.length - 1),
        );
        record({
          at: Date.now(),
          storeRef: store.ref,
          text: joined,
          ok: last?.error == null,
          rowCount: nextSets.reduce((sum, set) => sum + (set.rows?.length ?? 0), 0),
          durationMs,
          ...(last?.error ? { error: last.error } : {}),
        });
      } finally {
        setScriptPending(false);
      }
    })();
  };

  const runText = (sqlText: string, includePii = !piiMasked, gate = asGate): void => {
    if (!store) return;
    setResultsOpen(true);
    setError(null);
    if (!tenantReady) {
      setError("Select a tenant first.");
      return;
    }
    if (isSql) {
      runBatch([sqlText], includePii, gate);
      return;
    }
    const started = Date.now();
    const parsed = parseKvQuery(sqlText);
    if (parsed.kind === "error") {
      setError(parsed.message);
      return;
    }
    setKvPending(true);
    const tenantOpt = tenant ? { tenant } : {};
    void (async () => {
      try {
        if (parsed.kind === "delete") {
          const removed = await storeDelete({
            ref: store.ref,
            keys: [parsed.key],
            ...tenantOpt,
          });
          if (removed.error) {
            finish({
              sqlText,
              nextRows: null,
              nextMeta: null,
              nextError: consoleError(removed.error),
              started,
            });
            return;
          }
          await queryClient.invalidateQueries({ queryKey: STORE_QUERY_KEY });
          const deleted = removed.data?.deleted ?? 0;
          finish({
            sqlText,
            nextRows: [{ key: parsed.key, deleted }],
            nextMeta: deleted > 0 ? `delete ${parsed.key}` : `delete ${parsed.key} · missing`,
            nextError: null,
            started,
          });
          return;
        }
        if (parsed.kind === "set") {
          const edited = await storeEdit({
            ref: store.ref,
            key: parsed.key,
            ...tenantOpt,
            patch: kvSetPatch(parsed),
            commit: true,
          });
          if (edited.error) {
            finish({
              sqlText,
              nextRows: null,
              nextMeta: null,
              nextError: consoleError(edited.error),
              started,
            });
            return;
          }
          await queryClient.invalidateQueries({ queryKey: STORE_QUERY_KEY });
        }
        const prefix = parsed.kind === "list" ? parsed.prefix : parsed.key;
        const res = await storeQuery({
          ref: store.ref,
          prefix,
          limit: parsed.kind === "list" ? 200 : 1,
          ...tenantOpt,
        });
        if (res.error) {
          finish({
            sqlText,
            nextRows: null,
            nextMeta: null,
            nextError: consoleError(res.error),
            started,
          });
          return;
        }
        const keys = res.data?.keys ?? [];
        const filtered = parsed.kind === "list" ? keys : keys.filter((k) => k.key === parsed.key);
        if (parsed.kind === "ttl") {
          const hit = filtered[0];
          finish({
            sqlText,
            nextRows: [
              {
                key: parsed.key,
                ttlMs: hit?.ttlMs ?? null,
                ttl: formatKvTtl(hit?.ttlMs ?? null),
              },
            ],
            nextMeta: hit ? `ttl ${parsed.key}` : `ttl ${parsed.key} · missing`,
            nextError: null,
            started,
          });
          return;
        }
        const rows =
          filtered.length > 0
            ? filtered.map((entry) => ({
                key: entry.key,
                value: entry.value ?? null,
                ttlMs: entry.ttlMs ?? null,
                sizeBytes: entry.sizeBytes ?? null,
              }))
            : parsed.kind === "set" && !parsed.keepValue
              ? [{ key: parsed.key, value: parsed.value ?? null, ttlMs: null, sizeBytes: null }]
              : [];
        finish({
          sqlText,
          nextRows: rows,
          nextMeta:
            parsed.kind === "set"
              ? `set ${parsed.key}`
              : `${rows.length} key${rows.length === 1 ? "" : "s"}`,
          nextError: null,
          started,
        });
      } finally {
        setKvPending(false);
      }
    })();
  };

  const run = (): void => {
    if (isSql) {
      runBatch(pendingBatch);
      return;
    }
    const from = Math.min(cursor.start, cursor.end);
    const to = Math.max(cursor.start, cursor.end);
    runText(to > from ? text.slice(from, to) : text);
  };

  const runAll = (): void => {
    runBatch(sqlBatchToRun(text, cursor.start, cursor.end, "all"));
  };

  const runExplain = (analyze: boolean): void => {
    runBatch(pendingBatch.map((stmt) => wrapExplain(stmt, analyze)));
  };

  const runLine = (line: number): void => {
    const stmt = statements.find((s) => s.startLine === line);
    if (stmt) runBatch([stmt.text]);
  };

  const changeStore = (ref: string): void => {
    const next = ofFacet.find((s) => s.ref === ref);
    setStoreRef(ref);
    if (active) setTabs((prev) => writeQueryTab(prev, active.id, seedEditor(next, facet, null)));
    setRows(null);
    setMeta(null);
    setExecuted(null);
    setError(null);
    setSets([]);
    setActiveSet(0);
  };

  const insertSchema = (name: string): void => {
    setText(isSql ? defaultSqlQuery(name) : defaultKvQuery(`${name}:`));
  };

  const addTab = (): void => {
    const next = addQueryTab(tabs, seedEditor(store, facet, null));
    const created = next[next.length - 1];
    if (!created || next === tabs) return;
    setTabs(next);
    setActiveId(created.id);
  };

  const persistSave = (tab: QueryTab): void => {
    if (isDefaultQueryTitle(tab.title)) return;
    setSaved((prev) => upsertSavedQuery(prev, { id: tab.id, title: tab.title, text: tab.text }));
    setSavedFlash(true);
    if (savedFlashTimer.current !== null) window.clearTimeout(savedFlashTimer.current);
    savedFlashTimer.current = window.setTimeout(() => setSavedFlash(false), 1200);
  };

  const commitRename = (id: string, nextTitle: string): void => {
    const next = renameQueryTab(tabs, id, nextTitle);
    setTabs(next);
    setRenamingId(null);
    if (!pendingSaveRef.current) return;
    pendingSaveRef.current = false;
    const tab = next.find((row) => row.id === id);
    if (tab) persistSave(tab);
  };

  const cancelRename = (): void => {
    pendingSaveRef.current = false;
    setRenamingId(null);
  };

  const beginRename = (tab: QueryTab): void => {
    setActiveId(tab.id);
    setRenamingId(tab.id);
    setRenameDraft(tab.title);
  };

  const saveActive = (): void => {
    if (!active) return;
    if (isDefaultQueryTitle(active.title)) {
      pendingSaveRef.current = true;
      beginRename(active);
      return;
    }
    persistSave(active);
  };

  const openSaved = (entry: SavedQuery): void => {
    const existing = tabs.find((t) => t.id === entry.id);
    if (existing) {
      setTabs((prev) =>
        writeQueryTab(renameQueryTab(prev, entry.id, entry.title), entry.id, entry.text),
      );
      setActiveId(entry.id);
      return;
    }
    if (tabs.length >= 8) {
      if (!active) return;
      setTabs((prev) =>
        writeQueryTab(renameQueryTab(prev, active.id, entry.title), active.id, entry.text),
      );
      return;
    }
    const next = [...tabs, { id: entry.id, title: entry.title, text: entry.text }];
    setTabs(next);
    setActiveId(entry.id);
  };

  const closeTab = (id: string): void => {
    if (renamingId === id) cancelRename();
    const next = closeQueryTab(tabs, id, seed);
    setTabs(next);
    if (activeId === id) setActiveId(next[next.length - 1]?.id ?? next[0]?.id ?? "q_1");
  };

  const pending = isSql ? sql.isPending || scriptPending : kvPending;
  const allShortcut =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform)
      ? "⌘⇧Enter"
      : "Ctrl+Shift+Enter";

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-slot="store-query-console"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
          event.preventDefault();
          saveActive();
        }
      }}
    >
      <header className="relative z-30 flex shrink-0 items-center gap-3 border-b border-border/60 px-3 py-2">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg border",
            spec.wellClass,
          )}
          aria-hidden
        >
          <HugeiconsIcon icon={spec.icon} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {isSql ? "SQL Query" : "KV Query"}
          </h2>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {store?.ref ?? "No store"}
            {isSql ? " · DML / DDL" : " · list / get / set / delete / ttl"}
            {selected
              ? ` · selection${pendingBatch.length > 1 ? ` (${pendingBatch.length})` : ""}`
              : isSql
                ? statements.length > 1
                  ? ` · ${statements.length} statements`
                  : " · current statement"
                : ""}
          </p>
        </div>
        {ofFacet.length > 1 ? (
          <div
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
            data-slot="store-query-store"
          >
            <span>Store</span>
            <Select
              value={store?.ref ?? ""}
              onValueChange={changeStore}
              className="z-40 inline-flex min-w-[8rem]"
            >
              <SelectTrigger
                aria-label="Query store"
                className="h-7 px-2 py-0 font-mono text-[11px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ofFacet.map((s) => (
                  <SelectItem key={s.ref} value={s.ref} className="font-mono text-[11px]">
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {tenancyDeclared ? (
          <div data-slot="store-query-tenant">
            <Select
              value={tenant ?? ""}
              onValueChange={(next) => onTenantChange(next.length > 0 ? next : null)}
              className="z-40 inline-flex min-w-[8rem]"
            >
              <SelectTrigger aria-label="Tenant" className="h-7 px-2 py-0 font-mono text-[11px]">
                <SelectValue placeholder="Select tenant…" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t} value={t} className="font-mono text-[11px]">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </header>

      <div
        className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/50 px-1.5"
        role="tablist"
        aria-label="Query tabs"
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "group/tab flex h-8 items-center gap-0.5 border-b-2 px-1",
              tab.id === activeId
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground",
            )}
          >
            {renamingId === tab.id ? (
              <input
                autoFocus
                value={renameDraft}
                maxLength={48}
                aria-label="Rename query"
                data-slot="store-query-tab-rename"
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setRenameDraft(event.target.value)}
                onBlur={() => commitRename(tab.id, renameDraft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRename(tab.id, renameDraft);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRename();
                  }
                }}
                className="h-5 min-w-[4.5rem] bg-transparent px-1.5 font-mono text-[11px] text-foreground outline-none"
                style={{ width: `${Math.max(6, renameDraft.length + 1)}ch` }}
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === activeId}
                title="Double-click to rename"
                data-slot="store-query-tab"
                onClick={() => setActiveId(tab.id)}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  beginRename(tab);
                }}
                className="max-w-[12rem] truncate px-1.5 font-mono text-[11px]"
              >
                {tab.title}
              </button>
            )}
            {saved.some((entry) => entry.id === tab.id) ? (
              <span
                className="size-1 shrink-0 rounded-full bg-foreground/50"
                aria-label="Saved"
                title="Saved"
              />
            ) : null}
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              onClick={() => closeTab(tab.id)}
              className="flex size-4 items-center justify-center rounded-sm opacity-0 hover:bg-muted group-hover/tab:opacity-100"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-2.5" />
            </button>
          </div>
        ))}
        <ToolbarTip label="New query">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="New query"
            disabled={tabs.length >= 8}
            onClick={addTab}
            data-slot="store-query-tab-add"
            className="ml-0.5"
          >
            <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
          </Button>
        </ToolbarTip>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-3 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => setText(isSql ? prettifySql(text) : prettifyKv(text))}
          data-slot="store-query-prettify"
        >
          <HugeiconsIcon icon={SourceCodeIcon} data-icon="inline-start" className="size-3.5" />
          Prettify
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-[11px]"
          onClick={saveActive}
          data-slot="store-query-save"
        >
          <HugeiconsIcon
            icon={savedFlash ? Tick02Icon : FloppyDiskIcon}
            data-icon="inline-start"
            className="size-3.5"
          />
          {savedFlash ? "Saved" : "Save"}
        </Button>
        <HistoryMenu
          entries={history}
          saved={saved}
          onPick={(entry) => {
            setText(entry.text);
            editorRef.current?.focus();
          }}
          onPickSaved={(entry) => {
            openSaved(entry);
            editorRef.current?.focus();
          }}
        />
        <Button
          type="button"
          variant={schemaOpen ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-[11px]"
          aria-pressed={schemaOpen}
          onClick={() => setSchemaOpen((v) => !v)}
          data-slot="store-query-schema"
        >
          <HugeiconsIcon icon={Database01Icon} data-icon="inline-start" className="size-3.5" />
          {isSql ? "Schema" : "Keys"}
        </Button>
        {isSql ? (
          <ToolbarTip
            label={
              piiMasked
                ? "PII hidden. Click to include cleartext (audited)."
                : "PII included. Click to remask."
            }
          >
            <Button
              type="button"
              variant={piiMasked ? "ghost" : "secondary"}
              size="sm"
              className={cn("h-7 text-[11px]", !piiMasked && "text-amber-800 dark:text-amber-300")}
              aria-pressed={!piiMasked}
              aria-label={piiMasked ? "Include PII: disabled" : "Include PII: enabled"}
              onClick={() => {
                const nextMasked = !piiMasked;
                setPiiMasked(nextMasked);
                if (executed && !isSqlWrite(executed)) {
                  runText(executed, !nextMasked);
                }
              }}
              data-slot="store-query-pii"
            >
              <HugeiconsIcon
                icon={SecurityCheckIcon}
                data-icon="inline-start"
                className="size-3.5"
              />
              PII
            </Button>
          </ToolbarTip>
        ) : null}
        {isSql ? (
          <QueryGateMenu
            manifest={manifest}
            asGate={asGate}
            onChange={(next) => {
              setAsGate(next);
              if (executed && !isSqlWrite(executed)) {
                runText(executed, !piiMasked, next);
              }
            }}
          />
        ) : null}
        {unbounded ? (
          <span
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-800 dark:text-amber-300"
            title="This SELECT has no LIMIT"
            data-slot="store-query-unbounded"
          >
            <HugeiconsIcon icon={Alert02Icon} className="size-3" />
            No LIMIT
          </span>
        ) : null}
        <span className="flex-1" />
        <div className="flex items-center">
          <ToolbarTip label={selected ? `Run selection (${shortcut})` : `Run (${shortcut})`}>
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1.5 rounded-r-none"
              disabled={!store || pending}
              onClick={run}
              data-slot="store-query-run"
            >
              {pending ? (
                <HugeiconsIcon icon={Loading03Icon} className="size-3.5 animate-spin" />
              ) : (
                <HugeiconsIcon icon={PlayIcon} className="size-3.5" />
              )}
              {selected ? "Run selection" : "Run"}
              <kbd className="hidden font-mono text-[10px] opacity-70 sm:inline">{shortcut}</kbd>
            </Button>
          </ToolbarTip>
          {isSql ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={(props) => (
                  <Button
                    {...props}
                    type="button"
                    size="sm"
                    className="h-7 rounded-l-none border-l border-primary-foreground/20 px-1.5"
                    disabled={!store || pending}
                    aria-label="More run options"
                    data-slot="store-query-run-menu"
                  >
                    <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5" />
                  </Button>
                )}
              />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={run}>
                    Run current
                    <span className="ml-auto font-mono text-[10px] opacity-60">{shortcut}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={runAll} disabled={statements.length < 2}>
                    Run all
                    <span className="ml-auto font-mono text-[10px] opacity-60">{allShortcut}</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => runExplain(false)}>EXPLAIN</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => runExplain(true)}>
                    EXPLAIN ANALYZE
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="72%" minSize="18%" className="min-h-0 overflow-hidden">
          <div className="flex h-full min-h-0">
            <QueryEditor
              value={text}
              onChange={setText}
              language={isSql ? "sql" : "kv"}
              onRun={run}
              onRunAll={isSql ? runAll : undefined}
              onRunLine={isSql ? runLine : undefined}
              runLines={runLines}
              onCursorChange={(start, end) => setCursor({ start, end })}
              editorRef={editorRef}
              label={isSql ? "SQL query" : "KV command"}
              tables={schemaTables}
              facet={facet}
            />
            {schemaOpen ? (
              <QuerySchemaPanel
                store={store}
                facet={facet}
                manifest={manifest}
                tenant={tenant}
                tenancyDeclared={tenancyDeclared}
                onPickTable={insertSchema}
                onPickColumn={(_table, column) => {
                  editorRef.current?.insert(isSql ? `"${column}"` : column);
                }}
                onCollapse={() => setSchemaOpen(false)}
              />
            ) : (
              <QuerySchemaCollapsed facet={facet} onExpand={() => setSchemaOpen(true)} />
            )}
          </div>
        </ResizablePanel>
        {resultsOpen ? (
          <>
            {/* Grip on the right so it does not sit on the Store tree splitter. */}
            <ResizableHandle withHandle className="justify-end pr-8" />
            <ResizablePanel defaultSize="28%" minSize="20%" className="min-h-0 overflow-hidden">
              <QueryResults
                rows={rows}
                error={error}
                pending={pending}
                meta={meta}
                executed={executed}
                executedLanguage={isSql ? "sql" : "kv"}
                storeRef={store?.ref}
                sets={sets}
                activeSet={activeSet}
                onSelectSet={(index) => applySet(sets, index)}
                onToggleCollapse={() => setResultsOpen(false)}
              />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
      {resultsOpen ? null : (
        <QueryResults
          rows={rows}
          error={error}
          pending={pending}
          meta={meta}
          executed={executed}
          executedLanguage={isSql ? "sql" : "kv"}
          storeRef={store?.ref}
          sets={sets}
          activeSet={activeSet}
          onSelectSet={(index) => applySet(sets, index)}
          collapsed
          onToggleCollapse={() => setResultsOpen(true)}
        />
      )}
    </div>
  );
}

function consoleError(error: {
  readonly code: string;
  readonly message?: string;
  readonly data?: unknown;
}): string {
  const data = error.data;
  const fromData =
    data && typeof data === "object" && "ref" in data && typeof data.ref === "string"
      ? data.ref
      : null;
  return fromData ?? error.message ?? error.code;
}

function writeChanges(rows: readonly QueryResultRow[]): number | null {
  if (rows.length !== 1) return null;
  const changes = rows[0]?.changes;
  return typeof changes === "number" && Number.isFinite(changes) ? changes : null;
}

function seedEditor(
  store: StoreListStore | null | undefined,
  facet: StoreQueryFacet,
  selectedEffectRef: string | null,
): string {
  if (!store) return facet === "sql" ? defaultSqlQuery() : defaultKvQuery();
  const selected = selectedEffectRef
    ? store.children.find((c) => c.effectRef === selectedEffectRef)?.name
    : undefined;
  const name = selected ?? firstChildName(store);
  return facet === "sql" ? defaultSqlQuery(name) : defaultKvQuery(name ? `${name}:` : undefined);
}

function HistoryMenu({
  entries,
  saved,
  onPick,
  onPickSaved,
}: {
  readonly entries: readonly QueryHistoryEntry[];
  readonly saved: readonly SavedQuery[];
  readonly onPick: (entry: QueryHistoryEntry) => void;
  readonly onPickSaved: (entry: SavedQuery) => void;
}): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(props) => (
          <Button
            {...props}
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            data-slot="store-query-history"
          >
            <HugeiconsIcon icon={Clock01Icon} data-icon="inline-start" className="size-3.5" />
            History
          </Button>
        )}
      />
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-mono text-[10px] tracking-[0.12em] uppercase">
            Saved
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {saved.length === 0 ? (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">
              Save a named query to keep it across sessions.
            </p>
          ) : (
            saved.map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                className="flex flex-col items-start gap-0.5 py-1.5"
                onClick={() => onPickSaved(entry)}
              >
                <span className="w-full truncate text-[11px]">{entry.title}</span>
                <span className="w-full truncate font-mono text-[10px] text-muted-foreground">
                  {historyPreview(entry.text)}
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-mono text-[10px] tracking-[0.12em] uppercase">
            Recent runs
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {entries.length === 0 ? (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">No runs this session.</p>
          ) : (
            entries.map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                className="flex flex-col items-start gap-0.5 py-1.5"
                onClick={() => onPick(entry)}
              >
                <span className="w-full truncate font-mono text-[11px]">
                  {historyPreview(entry.text)}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {entry.ok
                    ? `${entry.rowCount ?? 0} · ${entry.durationMs}ms`
                    : (entry.error ?? "failed")}
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
