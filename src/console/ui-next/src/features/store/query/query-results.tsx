/**
 * Query console results — table / JSON / raw, copy, download, cell inspect.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Copy01Icon,
  Csv01Icon,
  FileBracesCornerIcon,
  FileExportIcon,
  LeftToRightListBulletIcon,
  PlayIcon,
  SourceCodeIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  EXPLORER_STRIP_CLASS,
  EXPLORER_STRIP_TOKEN_ACTIVE_CLASS,
  EXPLORER_STRIP_TOKEN_CLASS,
  EXPLORER_STRIP_TOKEN_IDLE_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { HighlightedJson } from "@/components/highlighted-json";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { EASE_OUT } from "@/lib/ease.ts";
import { motion, useReducedMotion } from "@/lib/motion.ts";
import { cn } from "@/lib/utils.ts";
import { JsonValueSheet } from "../detail/json-value-sheet.tsx";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { cellExportText, rowsToCsv } from "../lib/grid-transfer.ts";
import { formatGridCell } from "../lib/grid-model.ts";
import { asInspectableJson } from "../lib/json-value.ts";
import type { QueryHighlightLanguage } from "../lib/query-highlight.ts";
import { QueryHighlightView } from "./query-highlight-view.tsx";

/** One result row. */
export type QueryResultRow = Readonly<Record<string, unknown>>;

/** One statement result in a script run. */
export type QueryResultSet = {
  readonly label: string;
  readonly rows: readonly QueryResultRow[] | null;
  readonly error: string | null;
  readonly meta: string | null;
  readonly executed: string;
};

/** Props for {@link QueryResults}. */
export interface QueryResultsProps {
  readonly rows: readonly QueryResultRow[] | null;
  readonly error: string | null;
  readonly pending: boolean;
  readonly meta?: string | null;
  /** Statement that produced the current result (raw view). */
  readonly executed?: string | null;
  readonly executedLanguage?: QueryHighlightLanguage;
  readonly storeRef?: string;
  readonly collapsed?: boolean;
  readonly onToggleCollapse?: () => void;
  readonly sets?: readonly QueryResultSet[];
  readonly activeSet?: number;
  readonly onSelectSet?: (index: number) => void;
}

/**
 * Results pane under the query editor.
 *
 * @param props - Rows + error + status
 */
export function QueryResults({
  rows,
  error,
  pending,
  meta,
  executed,
  executedLanguage = "sql",
  storeRef = "sql:query",
  collapsed = false,
  onToggleCollapse,
  sets = [],
  activeSet = 0,
  onSelectSet,
}: QueryResultsProps): JSX.Element {
  const [view, setView] = useState<"table" | "json" | "raw">("table");
  const [copied, setCopied] = useState<"json" | "csv" | null>(null);
  const [inspect, setInspect] = useState<{
    rowId: string;
    column: string;
    value: unknown;
  } | null>(null);
  const columns = useMemo(() => columnKeys(rows ?? []), [rows]);
  const jsonText = useMemo(() => JSON.stringify(rows ?? [], null, 2), [rows]);
  const csvText = useMemo(() => {
    if (!rows || rows.length === 0) return "";
    return rowsToCsv(
      columns,
      rows.map((row) => columns.map((col) => cellExportText(row[col]))),
    );
  }, [rows, columns]);

  const reduce = useReducedMotion() ?? false;
  const wasPending = useRef(pending);
  const [appearId, setAppearId] = useState(0);
  useEffect(() => {
    if (wasPending.current && !pending) setAppearId((n) => n + 1);
    wasPending.current = pending;
  }, [pending]);

  const copy = (kind: "json" | "csv"): void => {
    const text = kind === "csv" ? csvText : jsonText;
    if (!navigator.clipboard || text.length === 0) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1200);
    });
  };

  const download = (kind: "json" | "csv"): void => {
    const text = kind === "csv" ? csvText : jsonText;
    if (text.length === 0) return;
    const blob = new Blob([text], {
      type: kind === "csv" ? "text/csv" : "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = kind === "csv" ? "query-results.csv" : "query-results.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasRows = rows !== null && rows.length > 0;

  return (
    <div
      className={cn("flex min-h-0 flex-col overflow-hidden", collapsed ? "shrink-0" : "h-full")}
      data-slot="store-query-results"
    >
      <div className={cn(EXPLORER_STRIP_CLASS, collapsed && "border-t border-b-0")}>
        {sets.length > 1
          ? sets.map((set, index) => (
              <button
                key={`${set.label}-${index}`}
                type="button"
                aria-pressed={index === activeSet}
                onClick={() => onSelectSet?.(index)}
                className={cn(
                  EXPLORER_STRIP_TOKEN_CLASS,
                  "font-mono",
                  index === activeSet
                    ? EXPLORER_STRIP_TOKEN_ACTIVE_CLASS
                    : EXPLORER_STRIP_TOKEN_IDLE_CLASS,
                )}
              >
                {index + 1} {set.label}
              </button>
            ))
          : null}
        <StripIcon
          label="Table"
          icon={LeftToRightListBulletIcon}
          active={view === "table"}
          onClick={() => setView("table")}
        />
        <StripIcon
          label="JSON"
          icon={SourceCodeIcon}
          active={view === "json"}
          onClick={() => setView("json")}
        />
        <StripIcon
          label="Executed statement"
          icon={FileExportIcon}
          active={view === "raw"}
          onClick={() => setView("raw")}
        />
        <span className="flex min-w-0 flex-1 items-center truncate px-2 text-[11px] text-muted-foreground">
          {error
            ? error
            : pending
              ? "Running…"
              : (meta ?? "No results yet. Run a query to see results here.")}
        </span>
        <StripIcon
          label={copied === "json" ? "Copied" : "Copy JSON"}
          icon={copied === "json" ? Tick02Icon : Copy01Icon}
          disabled={!hasRows}
          onClick={() => copy("json")}
        />
        <StripIcon
          label="Download JSON"
          icon={FileBracesCornerIcon}
          disabled={!hasRows}
          onClick={() => download("json")}
        />
        <StripIcon
          label={copied === "csv" ? "Copied" : "Copy CSV"}
          icon={copied === "csv" ? Tick02Icon : Csv01Icon}
          disabled={!hasRows}
          onClick={() => copy("csv")}
        />
        {onToggleCollapse ? (
          <StripIcon
            label={collapsed ? "Expand results" : "Collapse results"}
            icon={collapsed ? ArrowUp01Icon : ArrowDown01Icon}
            expanded={!collapsed}
            slot="store-query-results-collapse"
            onClick={onToggleCollapse}
          />
        ) : null}
      </div>

      {collapsed ? null : (
        <div className="min-h-0 flex-1 overflow-auto">
          {pending ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Running…</p>
          ) : (
            <motion.div
              key={appearId}
              initial={
                appearId === 0
                  ? false
                  : reduce
                    ? { opacity: 0 }
                    : { opacity: 0, transform: "translateY(4px)" }
              }
              animate={reduce ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px)" }}
              transition={{ duration: reduce ? 0.12 : 0.18, ease: EASE_OUT }}
            >
              {error ? (
                <p
                  className="px-3 py-4 font-mono text-xs leading-relaxed text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              ) : rows === null && view !== "raw" ? (
                <Empty className="h-full min-h-40 border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <HugeiconsIcon icon={PlayIcon} className="size-4" />
                    </EmptyMedia>
                    <EmptyTitle>No results yet</EmptyTitle>
                    <EmptyDescription>Run a query to see results here.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : view === "raw" ? (
                executed ? (
                  <div className="p-3" data-slot="store-query-raw">
                    <QueryHighlightView
                      code={executed}
                      language={executedLanguage}
                      className="text-xs leading-5"
                    />
                  </div>
                ) : (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                    Nothing executed yet.
                  </p>
                )
              ) : view === "json" ? (
                <HighlightedJson
                  json={jsonText}
                  dataSlot="store-query-json"
                  className="min-h-full p-3"
                />
              ) : rows && rows.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Query returned 0 rows.
                </p>
              ) : (
                <table className="w-full min-w-max border-collapse text-left text-[12px]">
                  <thead className="sticky top-0 z-10 bg-background">
                    <tr>
                      {columns.map((col) => (
                        <th
                          key={col}
                          scope="col"
                          className="border-b border-border/60 px-3 py-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(rows ?? []).map((row, i) => (
                      <tr key={i} className="border-b border-border/60 hover:bg-muted/50">
                        {columns.map((col) => {
                          const value = row[col];
                          const inspectable = asInspectableJson(value) !== null;
                          return (
                            <td
                              key={col}
                              className="max-w-xs truncate px-3 py-1.5 font-mono text-foreground/90"
                            >
                              {inspectable ? (
                                <button
                                  type="button"
                                  className="max-w-full truncate text-left underline decoration-border/70 underline-offset-2 hover:text-foreground"
                                  onClick={() =>
                                    setInspect({ rowId: String(i), column: col, value })
                                  }
                                >
                                  {formatGridCell(value)}
                                </button>
                              ) : (
                                formatGridCell(value)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </motion.div>
          )}
        </div>
      )}

      <JsonValueSheet
        open={inspect !== null}
        onOpenChange={(open) => {
          if (!open) setInspect(null);
        }}
        rowId={inspect?.rowId ?? ""}
        column={inspect?.column ?? ""}
        storeRef={storeRef}
        value={inspect?.value}
        editable={false}
      />
    </div>
  );
}

function columnKeys(rows: readonly QueryResultRow[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function StripIcon({
  label,
  icon,
  active = false,
  disabled = false,
  expanded,
  slot,
  onClick,
}: {
  readonly label: string;
  readonly icon: typeof LeftToRightListBulletIcon;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly expanded?: boolean;
  readonly slot?: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <ToolbarTip label={label} className="flex self-stretch">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active || undefined}
        aria-expanded={expanded}
        disabled={disabled}
        data-slot={slot}
        onClick={onClick}
        className={cn(
          EXPLORER_STRIP_TOKEN_CLASS,
          active ? EXPLORER_STRIP_TOKEN_ACTIVE_CLASS : EXPLORER_STRIP_TOKEN_IDLE_CLASS,
          disabled && "pointer-events-none opacity-40",
        )}
      >
        <HugeiconsIcon icon={icon} className="size-3.5" />
      </button>
    </ToolbarTip>
  );
}
