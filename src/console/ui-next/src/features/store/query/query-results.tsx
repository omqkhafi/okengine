/**
 * Query console results — table / JSON / raw, copy, download, cell inspect.
 */

import { useMemo, useState, type JSX } from "react";
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
import { AgentCode } from "@/components/agents/agent-code.tsx";
import { HighlightedJson } from "@/components/highlighted-json";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils.ts";
import { JsonValueSheet } from "../detail/json-value-sheet.tsx";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { cellExportText, rowsToCsv } from "../lib/grid-transfer.ts";
import { formatGridCell } from "../lib/grid-model.ts";
import { asInspectableJson } from "../lib/json-value.ts";

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
  readonly executedLanguage?: "sql" | "bash";
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
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 px-2 py-1",
          collapsed ? "border-t border-border/50" : "border-b border-border/50",
        )}
      >
        {sets.length > 1
          ? sets.map((set, index) => (
              <button
                key={`${set.label}-${index}`}
                type="button"
                aria-pressed={index === activeSet}
                onClick={() => onSelectSet?.(index)}
                className={cn(
                  "h-6 shrink-0 rounded-md px-1.5 font-mono text-[10px]",
                  index === activeSet
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {index + 1} {set.label}
              </button>
            ))
          : null}
        <ViewToggle
          active={view === "table"}
          label="Table"
          icon={LeftToRightListBulletIcon}
          onClick={() => setView("table")}
        />
        <ViewToggle
          active={view === "json"}
          label="JSON"
          icon={SourceCodeIcon}
          onClick={() => setView("json")}
        />
        <ViewToggle
          active={view === "raw"}
          label="Executed statement"
          icon={FileExportIcon}
          onClick={() => setView("raw")}
        />
        <span className="min-w-0 flex-1 truncate px-2 text-[11px] text-muted-foreground">
          {error
            ? error
            : pending
              ? "Running…"
              : (meta ?? "No results yet. Run a query to see results here.")}
        </span>
        <ToolbarTip label={copied === "json" ? "Copied" : "Copy JSON"}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Copy results as JSON"
            disabled={!hasRows}
            onClick={() => copy("json")}
          >
            <HugeiconsIcon
              icon={copied === "json" ? Tick02Icon : Copy01Icon}
              className="size-3.5"
            />
          </Button>
        </ToolbarTip>
        <ToolbarTip label="Download JSON">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Download results as JSON"
            disabled={!hasRows}
            onClick={() => download("json")}
          >
            <HugeiconsIcon icon={FileBracesCornerIcon} className="size-3.5" />
          </Button>
        </ToolbarTip>
        <ToolbarTip label={copied === "csv" ? "Copied" : "Copy CSV"}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Copy results as CSV"
            disabled={!hasRows}
            onClick={() => copy("csv")}
          >
            <HugeiconsIcon
              icon={copied === "csv" ? Tick02Icon : Csv01Icon}
              className="size-3.5"
            />
          </Button>
        </ToolbarTip>
        {onToggleCollapse ? (
          <ToolbarTip label={collapsed ? "Expand results" : "Collapse results"}>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={collapsed ? "Expand results" : "Collapse results"}
              aria-expanded={!collapsed}
              data-slot="store-query-results-collapse"
              onClick={onToggleCollapse}
            >
              <HugeiconsIcon
                icon={collapsed ? ArrowUp01Icon : ArrowDown01Icon}
                className="size-3.5"
              />
            </Button>
          </ToolbarTip>
        ) : null}
      </div>

      {collapsed ? null : (
        <div className="min-h-0 flex-1 overflow-auto">
          {error ? (
            <p
              className="px-3 py-4 font-mono text-xs leading-relaxed text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : pending ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Running…</p>
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
                <AgentCode
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
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col}
                      scope="col"
                      className="border-b border-border/60 px-3 py-1.5 font-mono text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((row, i) => (
                  <tr key={i} className="border-b border-border/40 hover:bg-muted/30">
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
                              onClick={() => setInspect({ rowId: String(i), column: col, value })}
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

function ViewToggle({
  active,
  label,
  icon,
  onClick,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly icon: typeof LeftToRightListBulletIcon;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <ToolbarTip label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn(active && "bg-muted text-foreground")}
      >
        <HugeiconsIcon icon={icon} className="size-3.5" />
      </Button>
    </ToolbarTip>
  );
}
