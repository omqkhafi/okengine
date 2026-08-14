/**
 * Create a Postgres index from the Indexes catalog.
 */

import { useEffect, useMemo, useState, type JSX, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select.tsx";
import {
  SHEET_CONTROL,
  SheetChapter,
  SheetChoice,
  SheetChoiceRow,
  SheetError,
  SheetField,
  SheetFooterButton,
  SheetPair,
  SheetSwitchRow,
} from "@/components/ui/sheet-form.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/motion/switch.tsx";
import { cn } from "@/lib/utils.ts";
import { useStoreSql } from "../data/use-store-sql.ts";
import { STORE_QUERY_KEY } from "../data/use-store-query.ts";
import { SqlStyleEditor } from "../query/sql-style-editor.tsx";
import { CatalogAdvancedToggle, CatalogTemplateStrip } from "./catalog-advanced.tsx";
import {
  buildCreateIndexSql,
  isCreateIndexSql,
  sqlIndexAdvancedCount,
  SQL_INDEX_TEMPLATES,
  type SqlIndexMethod,
  type SqlIndexTemplate,
} from "../lib/sql-index.ts";

const METHODS: readonly SqlIndexMethod[] = ["btree", "hash", "gin", "gist", "brin"];

/** Props for {@link SqlIndexSheet}. */
export interface SqlIndexSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly storeRef: string;
  readonly tables: readonly string[];
}

/**
 * Sheet to review and run `CREATE INDEX`.
 *
 * @param props - Store + table names
 */
export function SqlIndexSheet({
  open,
  onOpenChange,
  storeRef,
  tables,
}: SqlIndexSheetProps): JSX.Element {
  const qc = useQueryClient();
  const { mutate, isPending, reset } = useStoreSql();
  const [name, setName] = useState("");
  const [table, setTable] = useState(tables[0] ?? "");
  const [columns, setColumns] = useState("column_name");
  const [method, setMethod] = useState<SqlIndexMethod>("btree");
  const [unique, setUnique] = useState(false);
  const [ifNotExists, setIfNotExists] = useState(false);
  const [where, setWhere] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [concurrently, setConcurrently] = useState(false);
  const [include, setInclude] = useState("");
  const [nullsNotDistinct, setNullsNotDistinct] = useState(false);
  const [storage, setStorage] = useState("");
  const [sql, setSql] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);

  const built = useMemo(
    () =>
      buildCreateIndexSql({
        name: name.trim() || "index_name",
        table: table.trim() || "table_name",
        columns,
        method,
        unique,
        ifNotExists,
        concurrently,
        nullsNotDistinct,
        ...(where.trim() !== "" ? { where } : {}),
        ...(include.trim() !== "" ? { include } : {}),
        ...(storage.trim() !== "" ? { with: storage } : {}),
      }),
    [
      name,
      table,
      columns,
      method,
      unique,
      ifNotExists,
      where,
      concurrently,
      include,
      nullsNotDistinct,
      storage,
    ],
  );

  useEffect(() => {
    if (!open) return;
    const nextTable = tables[0] ?? "";
    setName("");
    setTable(nextTable);
    setColumns("column_name");
    setMethod("btree");
    setUnique(false);
    setIfNotExists(false);
    setWhere("");
    setAdvanced(false);
    setConcurrently(false);
    setInclude("");
    setNullsNotDistinct(false);
    setStorage("");
    setTemplateId(null);
    setError(null);
    setSql(
      buildCreateIndexSql({
        name: "index_name",
        table: nextTable || "table_name",
        columns: "column_name",
      }),
    );
    reset();
  }, [open, tables, reset]);

  useEffect(() => {
    setSql(built);
  }, [built]);

  const applyTemplate = (tpl: SqlIndexTemplate): void => {
    setTemplateId(tpl.id);
    setColumns(tpl.columns);
    setMethod(tpl.method ?? "btree");
    setUnique(tpl.unique === true);
    setWhere(tpl.where ?? "");
    if (name.trim() === "") setName(tpl.id.replaceAll("-", "_"));
  };

  const submit = (): void => {
    if (!isCreateIndexSql(sql)) {
      setError("This sheet runs CREATE INDEX only");
      return;
    }
    setError(null);
    mutate(
      { ref: storeRef, sql, allowWrite: true },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: STORE_QUERY_KEY });
          onOpenChange(false);
        },
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
    event.preventDefault();
    if (!isPending) submit();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden data-[side=right]:sm:max-w-xl"
        data-slot="sql-index-sheet"
        onKeyDown={onKeyDown}
      >
        <SheetHeader className="shrink-0 gap-2 border-b border-border/50">
          <div className="flex items-start gap-3">
            <div className="flex size-9 items-center justify-center rounded-full border border-border/50 bg-muted/20">
              <HugeiconsIcon icon={Key01Icon} className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-sm">Create index</SheetTitle>
              <SheetDescription className="text-[11px]">
                Review the `CREATE INDEX` SQL before it runs
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <CatalogTemplateStrip
            templates={SQL_INDEX_TEMPLATES}
            selectedId={templateId}
            onSelect={applyTemplate}
          />
          <SheetPair>
            <SheetField label="Index name" split="start">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="index_name"
                flat
                className={cn(SHEET_CONTROL, "font-mono")}
              />
            </SheetField>
            <SheetField label="Table" split="end">
              <Select value={table} onValueChange={setTable}>
                <SelectTrigger flat className={cn(SHEET_CONTROL, "font-mono")}>
                  <SelectValue placeholder="Select a table" />
                </SelectTrigger>
                <SelectContent>
                  {tables.map((item) => (
                    <SelectItem key={item} value={item} className="font-mono text-[12px]">
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SheetField>
          </SheetPair>
          <SheetField label="Columns">
            <Input
              value={columns}
              onChange={(event) => setColumns(event.target.value)}
              placeholder="column_name"
              flat
              className={cn(SHEET_CONTROL, "font-mono")}
            />
          </SheetField>
          <SheetChoiceRow label="Method">
            {METHODS.map((item) => (
              <SheetChoice key={item} active={method === item} onClick={() => setMethod(item)}>
                {item}
              </SheetChoice>
            ))}
          </SheetChoiceRow>
          <SheetField label="WHERE">
            <Input
              value={where}
              onChange={(event) => setWhere(event.target.value)}
              placeholder="optional"
              flat
              className={cn(SHEET_CONTROL, "font-mono")}
            />
          </SheetField>
          <SheetPair>
            <SheetSwitchRow label="Unique" className="border-r border-b-0">
              <Switch size="sm" checked={unique} onCheckedChange={setUnique} ariaLabel="Unique" />
            </SheetSwitchRow>
            <SheetSwitchRow label="Skip if it exists" className="border-b-0">
              <Switch
                size="sm"
                checked={ifNotExists}
                onCheckedChange={setIfNotExists}
                ariaLabel="Skip if it already exists"
              />
            </SheetSwitchRow>
          </SheetPair>
          <SheetChapter label="Options">
            <CatalogAdvancedToggle
              open={advanced}
              extraCount={sqlIndexAdvancedCount({
                concurrently,
                include,
                nullsNotDistinct,
                with: storage,
              })}
              onOpenChange={setAdvanced}
              controls="sql-index-advanced"
            />
          </SheetChapter>
          {advanced ? (
            <div id="sql-index-advanced">
              <SheetSwitchRow label="Concurrently">
                <Switch
                  size="sm"
                  checked={concurrently}
                  onCheckedChange={setConcurrently}
                  ariaLabel="Create index concurrently"
                />
              </SheetSwitchRow>
              <SheetField label="INCLUDE">
                <Input
                  value={include}
                  onChange={(event) => setInclude(event.target.value)}
                  placeholder="covering columns"
                  flat
                  className={cn(SHEET_CONTROL, "font-mono")}
                />
              </SheetField>
              <SheetSwitchRow label="NULLS NOT DISTINCT">
                <Switch
                  size="sm"
                  checked={nullsNotDistinct}
                  onCheckedChange={setNullsNotDistinct}
                  ariaLabel="NULLS NOT DISTINCT"
                />
              </SheetSwitchRow>
              <SheetField label="WITH">
                <Input
                  value={storage}
                  onChange={(event) => setStorage(event.target.value)}
                  placeholder="fillfactor = 70"
                  flat
                  className={cn(SHEET_CONTROL, "font-mono")}
                />
              </SheetField>
            </div>
          ) : null}
        </div>
        <div className="shrink-0 border-t border-border/50" data-slot="sql-index-sql-dock">
          <SheetChapter label="SQL" hint="Editable before it runs" />
          <SqlStyleEditor
            value={sql}
            onChange={setSql}
            onSubmit={isPending ? undefined : submit}
            label="CREATE INDEX SQL"
            className="min-h-36 max-h-48"
          />
          {error ? <SheetError slot="sql-index-error">{error}</SheetError> : null}
        </div>

        <SheetFooter>
          <SheetFooterButton split onClick={() => onOpenChange(false)}>
            Cancel
          </SheetFooterButton>
          <SheetFooterButton
            variant="default"
            disabled={isPending || !isCreateIndexSql(sql)}
            onClick={submit}
            data-slot="sql-index-submit"
          >
            {isPending ? "Creating…" : "Create index"}
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
