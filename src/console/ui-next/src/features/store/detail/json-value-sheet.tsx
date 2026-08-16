/**
 * JSON cell inspect Sheet — Table of flattened fields + pretty JSON.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { HighlightedJson } from "@/components/highlighted-json";
import { EditableCell } from "@/components/motion/table/editable-cell.tsx";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ShortcutKeys } from "@/lib/shortcut-keys.tsx";
import { modChord } from "@/lib/shortcut.ts";
import { cn } from "@/lib/utils";
import { formatGridCell } from "../lib/grid-model.ts";
import {
  asInspectableJson,
  fieldDraftText,
  jsonFieldRows,
  jsonValueEqual,
  parseInspectableJsonText,
  parseJsonFieldDraft,
  prettyJsonCell,
  setJsonField,
  type JsonFieldKind,
  type JsonFieldRow,
} from "../lib/json-value.ts";
import { isRtlText } from "../lib/rtl.ts";

/** Props for {@link JsonValueSheet}. */
export interface JsonValueSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly rowId: string;
  readonly column: string;
  readonly storeRef: string;
  readonly value: unknown;
  /** Value before pending edits — used to tint dirty fields. */
  readonly originalValue?: unknown;
  readonly editable?: boolean;
  readonly onChange?: (next: unknown) => void;
}

/**
 * Right-side inspect for one JSON cell — readable field table and source.
 *
 * @param props - Cell identity + raw value
 */
export function JsonValueSheet({
  open,
  onOpenChange,
  rowId,
  column,
  storeRef,
  value,
  originalValue,
  editable = false,
  onChange,
}: JsonValueSheetProps): JSX.Element {
  const [tab, setTab] = useState<"table" | "json">("table");
  const [copied, setCopied] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const jsonFocused = useRef(false);
  const canEdit = editable && onChange !== undefined;

  useEffect(() => {
    if (open) {
      setTab("table");
      setCopied(false);
      setJsonError(null);
      jsonFocused.current = false;
    }
  }, [open, rowId, column]);

  const rows = useMemo(() => jsonFieldRows(value), [value]);
  const originalByPath = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const row of jsonFieldRows(originalValue ?? value)) {
      map.set(row.path, row.value);
    }
    return map;
  }, [originalValue, value]);
  const pretty = useMemo(() => prettyJsonCell(value), [value]);
  const parsed = asInspectableJson(value);
  const fieldCount = rows.length;
  const isArray = Array.isArray(parsed);
  const jsonDirty = jsonDraft !== pretty;

  useEffect(() => {
    if (jsonFocused.current) return;
    setJsonDraft(pretty);
    setJsonError(null);
  }, [pretty]);

  const commitField = (row: JsonFieldRow, text: string) => {
    if (!onChange || parsed === null) return;
    const next = setJsonField(parsed, row.path, parseJsonFieldDraft(row.kind, text));
    onChange(next);
  };

  const commitJsonDraft = () => {
    if (!onChange) return;
    const result = parseInspectableJsonText(jsonDraft);
    if (!result.ok) {
      setJsonError(result.error);
      return;
    }
    setJsonError(null);
    onChange(result.value);
  };

  const copyJson = () => {
    if (!navigator.clipboard) return;
    const text = tab === "json" ? jsonDraft : pretty;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="gap-0 p-0 data-[side=right]:sm:max-w-xl"
        data-slot="json-value-sheet"
      >
        <SheetHeader className="gap-2 border-b border-border/50">
          <div className="flex flex-col gap-0.5 pr-8">
            <SheetTitle className="text-sm">
              <span className="font-mono">{rowId}</span>
            </SheetTitle>
            <SheetDescription className="font-mono text-[11px]">
              {storeRef}
              <span className="text-border"> · </span>
              {column}
              {fieldCount > 0 ? (
                <>
                  <span className="text-border"> · </span>
                  {fieldCount} {fieldCount === 1 ? "field" : "fields"}
                </>
              ) : null}
            </SheetDescription>
          </div>
          <div className="flex items-center gap-4" role="tablist" aria-label="JSON value tabs">
            <TabButton active={tab === "table"} onClick={() => setTab("table")} id="table">
              Table
            </TabButton>
            <TabButton active={tab === "json"} onClick={() => setTab("json")} id="json">
              JSON
            </TabButton>
          </div>
        </SheetHeader>

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col px-4 pb-2",
            tab === "json" ? "overflow-hidden pt-3" : "overflow-y-auto",
          )}
        >
          {tab === "table" ? (
            fieldCount === 0 ? (
              <p
                className="px-1 py-8 text-center text-sm text-muted-foreground"
                data-slot="json-value-empty"
              >
                {isArray ? "Empty array." : "No fields."}
              </p>
            ) : (
              <table className="w-full table-fixed border-collapse" data-slot="json-value-table">
                <colgroup>
                  <col className="w-[30%]" />
                  <col className="w-12" />
                  <col />
                </colgroup>
                <thead>
                  <tr className="border-b border-border/60 text-left">
                    <th className="sticky top-0 bg-popover py-2 pr-3 font-mono text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                      Field
                    </th>
                    <th className="sticky top-0 bg-popover py-2 pr-3 font-mono text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                      Type
                    </th>
                    <th className="sticky top-0 bg-popover py-2 font-mono text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {rows.map((row) => (
                    <tr key={row.path}>
                      <td className="align-top py-1.5 pr-3">
                        <span
                          className="block truncate font-mono text-[11px] font-medium text-muted-foreground"
                          title={row.path}
                        >
                          {row.path}
                        </span>
                      </td>
                      <td className="align-top py-1.5 pr-3">
                        <span className="font-mono text-[9px] text-muted-foreground/60">
                          {typeGlyph(row.kind)}
                        </span>
                      </td>
                      <td
                        className={cn(
                          "min-w-0 align-top py-1 font-mono text-[11px] break-words",
                          row.kind === "null" && !canEdit && "text-muted-foreground/40",
                          row.kind === "number" && "tabular-nums",
                          (row.kind === "object" || row.kind === "array") &&
                            !canEdit &&
                            "text-muted-foreground",
                        )}
                        dir={isRtlText(row.value) ? "rtl" : "ltr"}
                      >
                        {canEdit ? (
                          <EditableCell
                            value={fieldDraftText(row.value, row.kind)}
                            label={`Edit ${row.path}`}
                            dirty={!jsonValueEqual(originalByPath.get(row.path), row.value)}
                            onChange={(text) => commitField(row, text)}
                            className="min-h-7 w-full px-0 font-mono text-[11px]"
                          />
                        ) : (
                          formatFieldValue(row.value, row.kind)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            <JsonSourcePane
              pretty={pretty}
              draft={jsonDraft}
              error={jsonError}
              dirty={jsonDirty}
              editable={canEdit}
              onDraftChange={(next) => {
                setJsonDraft(next);
                if (jsonError) setJsonError(null);
              }}
              onFocusChange={(focused) => {
                jsonFocused.current = focused;
              }}
              onCommit={commitJsonDraft}
              onRevert={() => {
                setJsonDraft(pretty);
                setJsonError(null);
              }}
            />
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/50 px-4 py-2.5">
          {canEdit ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
              {tab === "json" ? (
                <>
                  Edit JSON · blur or
                  <ShortcutKeys keys={modChord("↵")} />
                  to apply
                </>
              ) : (
                "Click a value to edit · Changes to review"
              )}
            </span>
          ) : (
            <span />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyJson}
            data-slot="json-value-copy"
          >
            <HugeiconsIcon
              icon={copied ? Tick02Icon : Copy01Icon}
              className="size-3.5"
              aria-hidden
            />
            {copied ? "Copied" : "Copy JSON"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function JsonSourcePane({
  pretty,
  draft,
  error,
  dirty,
  editable,
  onDraftChange,
  onFocusChange,
  onCommit,
  onRevert,
}: {
  readonly pretty: string;
  readonly draft: string;
  readonly error: string | null;
  readonly dirty: boolean;
  readonly editable: boolean;
  readonly onDraftChange: (next: string) => void;
  readonly onFocusChange: (focused: boolean) => void;
  readonly onCommit: () => void;
  readonly onRevert: () => void;
}): JSX.Element {
  const gutterRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | null>(null);
  const lines = (editable ? draft : pretty).split("\n");

  useEffect(() => {
    const el = areaRef.current;
    const caret = caretRef.current;
    if (!el || caret === null) return;
    el.selectionStart = el.selectionEnd = caret;
    caretRef.current = null;
  }, [draft]);

  const syncGutter = () => {
    if (gutterRef.current && areaRef.current) {
      gutterRef.current.scrollTop = areaRef.current.scrollTop;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5" data-slot="json-value-source">
      <div
        className={cn(
          "flex min-h-0 flex-1 overflow-hidden rounded-md border",
          error ? "border-destructive/50" : dirty ? "border-amber-500/30" : "border-border/60",
        )}
      >
        {editable ? (
          <>
            <div
              ref={gutterRef}
              className="shrink-0 overflow-hidden border-r border-border/40 bg-muted/30 px-1.5 py-2 text-right font-mono text-[10px] leading-5 text-muted-foreground/80"
              aria-hidden
            >
              {lines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              ref={areaRef}
              value={draft}
              spellCheck={false}
              aria-label="JSON source"
              aria-invalid={error !== null}
              data-slot="json-value-editor"
              onFocus={() => onFocusChange(true)}
              onBlur={() => {
                onFocusChange(false);
                onCommit();
              }}
              onScroll={syncGutter}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Tab") {
                  event.preventDefault();
                  const start = event.currentTarget.selectionStart;
                  const end = event.currentTarget.selectionEnd;
                  caretRef.current = start + 2;
                  onDraftChange(`${draft.slice(0, start)}  ${draft.slice(end)}`);
                  return;
                }
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  elBlur(event.currentTarget);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onRevert();
                  elBlur(event.currentTarget);
                }
              }}
              className={cn(
                "min-h-0 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 font-mono text-[11px] leading-5",
                "shadow-none outline-none ring-0 focus-visible:outline-none",
                dirty ? "text-[#9a5b12] dark:text-[#e8c48a]" : "text-foreground",
              )}
            />
          </>
        ) : (
          <HighlightedJson
            json={pretty}
            dataSlot="json-value-highlight"
            className="flex min-h-0 flex-1 overflow-auto"
          />
        )}
      </div>
      {error ? (
        <p className="text-[11px] text-destructive" role="alert" data-slot="json-value-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function elBlur(el: HTMLTextAreaElement): void {
  el.blur();
}

function typeGlyph(kind: JsonFieldKind): string {
  switch (kind) {
    case "number":
      return "123";
    case "boolean":
      return "0/1";
    case "null":
      return "∅";
    case "object":
    case "array":
      return "{ }";
    default:
      return "abc";
  }
}

function formatFieldValue(value: unknown, kind: JsonFieldKind): string {
  if (kind === "object") return "{}";
  if (kind === "array") return "[]";
  return formatGridCell(value);
}

function TabButton({
  active,
  onClick,
  id,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly id: string;
  readonly children: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      id={`json-tab-${id}`}
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "px-2 py-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase transition-colors hover:bg-muted/50",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      data-slot={`json-tab-${id}`}
    >
      {children}
    </button>
  );
}
