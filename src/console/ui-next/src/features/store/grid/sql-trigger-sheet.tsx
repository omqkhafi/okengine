/**
 * Create a Postgres trigger from the Triggers catalog.
 */

import { useEffect, useMemo, useState, type JSX, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ZapIcon } from "@hugeicons/core-free-icons";
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
  buildCreateTriggerSql,
  isCreateTriggerSql,
  sqlTriggerAdvancedCount,
  SQL_TRIGGER_TEMPLATES,
  type SqlTriggerDefer,
  type SqlTriggerEvent,
  type SqlTriggerLevel,
  type SqlTriggerTemplate,
  type SqlTriggerTiming,
} from "../lib/sql-trigger.ts";

const TIMINGS: readonly SqlTriggerTiming[] = ["BEFORE", "AFTER", "INSTEAD OF"];
const EVENTS: readonly SqlTriggerEvent[] = ["INSERT", "UPDATE", "DELETE"];
const LEVELS: readonly SqlTriggerLevel[] = ["ROW", "STATEMENT"];
const DEFERS: readonly { readonly id: SqlTriggerDefer; readonly label: string }[] = [
  { id: "immediate", label: "IMMEDIATE" },
  { id: "deferred", label: "DEFERRED" },
];

/** Props for {@link SqlTriggerSheet}. */
export interface SqlTriggerSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly storeRef: string;
  readonly tables: readonly string[];
}

/**
 * Sheet to review and run `CREATE TRIGGER`.
 *
 * @param props - Store + table names
 */
export function SqlTriggerSheet({
  open,
  onOpenChange,
  storeRef,
  tables,
}: SqlTriggerSheetProps): JSX.Element {
  const qc = useQueryClient();
  const { mutate, isPending, reset } = useStoreSql();
  const [name, setName] = useState("");
  const [table, setTable] = useState(tables[0] ?? "");
  const [timing, setTiming] = useState<SqlTriggerTiming>("AFTER");
  const [events, setEvents] = useState<readonly SqlTriggerEvent[]>(["INSERT"]);
  const [level, setLevel] = useState<SqlTriggerLevel>("ROW");
  const [functionName, setFunctionName] = useState("");
  const [when, setWhen] = useState("");
  const [orReplace, setOrReplace] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [constraint, setConstraint] = useState(false);
  const [defer, setDefer] = useState<SqlTriggerDefer | null>(null);
  const [updateOf, setUpdateOf] = useState("");
  const [referencingOld, setReferencingOld] = useState("");
  const [referencingNew, setReferencingNew] = useState("");
  const [functionArgs, setFunctionArgs] = useState("");
  const [sql, setSql] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);

  const built = useMemo(
    () =>
      buildCreateTriggerSql({
        name: name.trim() || "trigger_name",
        table: table.trim() || "table_name",
        timing,
        events,
        level,
        functionName: functionName.trim() || "function_name",
        orReplace,
        constraint,
        ...(when.trim() !== "" ? { when } : {}),
        ...(defer !== null ? { defer } : {}),
        ...(updateOf.trim() !== "" ? { updateOf } : {}),
        ...(referencingOld.trim() !== "" ? { referencingOld } : {}),
        ...(referencingNew.trim() !== "" ? { referencingNew } : {}),
        ...(functionArgs.trim() !== "" ? { functionArgs } : {}),
      }),
    [
      name,
      table,
      timing,
      events,
      level,
      functionName,
      when,
      orReplace,
      constraint,
      defer,
      updateOf,
      referencingOld,
      referencingNew,
      functionArgs,
    ],
  );

  useEffect(() => {
    if (!open) return;
    const nextTable = tables[0] ?? "";
    setName("");
    setTable(nextTable);
    setTiming("AFTER");
    setEvents(["INSERT"]);
    setLevel("ROW");
    setFunctionName("");
    setWhen("");
    setOrReplace(false);
    setAdvanced(false);
    setConstraint(false);
    setDefer(null);
    setUpdateOf("");
    setReferencingOld("");
    setReferencingNew("");
    setFunctionArgs("");
    setTemplateId(null);
    setError(null);
    setSql(
      buildCreateTriggerSql({
        name: "trigger_name",
        table: nextTable || "table_name",
        timing: "AFTER",
        events: ["INSERT"],
        level: "ROW",
        functionName: "function_name",
      }),
    );
    reset();
  }, [open, tables, reset]);

  useEffect(() => {
    setSql(built);
  }, [built]);

  const applyTemplate = (tpl: SqlTriggerTemplate): void => {
    setTemplateId(tpl.id);
    setTiming(tpl.timing);
    setEvents(tpl.events);
    setLevel(tpl.level);
    if (name.trim() === "") setName(tpl.id.replaceAll("-", "_"));
  };

  const toggleEvent = (item: SqlTriggerEvent): void => {
    if (events.includes(item)) {
      if (events.length === 1) return;
      setEvents(events.filter((event) => event !== item));
      return;
    }
    const next = [...events, item];
    setEvents(next);
    if (item === "TRUNCATE") setLevel("STATEMENT");
  };

  const submit = (): void => {
    if (!isCreateTriggerSql(sql)) {
      setError("This sheet runs CREATE TRIGGER only");
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
        data-slot="sql-trigger-sheet"
        onKeyDown={onKeyDown}
      >
        <SheetHeader className="shrink-0 gap-2 border-b border-border/50">
          <div className="flex items-start gap-3">
            <div className="flex size-9 items-center justify-center rounded-full border border-border/50 bg-muted/20">
              <HugeiconsIcon icon={ZapIcon} className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-sm">New trigger</SheetTitle>
              <SheetDescription className="text-[11px]">
                Review the `CREATE TRIGGER` SQL before it runs
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <CatalogTemplateStrip
            templates={SQL_TRIGGER_TEMPLATES}
            selectedId={templateId}
            onSelect={applyTemplate}
          />
          <SheetPair>
            <SheetField label="Trigger name" split="start">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="trigger_name"
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
          <SheetChoiceRow label="Timing">
            {TIMINGS.map((item) => (
              <SheetChoice key={item} active={timing === item} onClick={() => setTiming(item)}>
                {item}
              </SheetChoice>
            ))}
          </SheetChoiceRow>
          <SheetChoiceRow label="Events">
            {EVENTS.map((item) => (
              <SheetChoice
                key={item}
                active={events.includes(item)}
                onClick={() => toggleEvent(item)}
              >
                {item}
              </SheetChoice>
            ))}
          </SheetChoiceRow>
          <SheetChoiceRow label="For each">
            {LEVELS.map((item) => (
              <SheetChoice key={item} active={level === item} onClick={() => setLevel(item)}>
                {item}
              </SheetChoice>
            ))}
          </SheetChoiceRow>
          <SheetPair>
            <SheetField label="Function" split="start">
              <Input
                value={functionName}
                onChange={(event) => setFunctionName(event.target.value)}
                placeholder="function_name"
                flat
                className={cn(SHEET_CONTROL, "font-mono")}
              />
            </SheetField>
            <SheetField label="WHEN" split="end">
              <Input
                value={when}
                onChange={(event) => setWhen(event.target.value)}
                placeholder="optional"
                flat
                className={cn(SHEET_CONTROL, "font-mono")}
              />
            </SheetField>
          </SheetPair>
          <SheetSwitchRow label="Replace if it already exists">
            <Switch
              size="sm"
              checked={orReplace}
              onCheckedChange={setOrReplace}
              ariaLabel="Replace if it already exists"
            />
          </SheetSwitchRow>
          <SheetChapter label="Options">
            <CatalogAdvancedToggle
              open={advanced}
              extraCount={sqlTriggerAdvancedCount({
                constraint,
                ...(defer !== null ? { defer } : {}),
                updateOf,
                referencingOld,
                referencingNew,
                functionArgs,
                events,
              })}
              onOpenChange={setAdvanced}
              controls="sql-trigger-advanced"
            />
          </SheetChapter>
          {advanced ? (
            <div id="sql-trigger-advanced">
              <SheetChoiceRow label="Also fire on">
                <SheetChoice
                  active={events.includes("TRUNCATE")}
                  onClick={() => toggleEvent("TRUNCATE")}
                >
                  TRUNCATE
                </SheetChoice>
              </SheetChoiceRow>
              {events.includes("UPDATE") ? (
                <SheetField label="UPDATE OF">
                  <Input
                    value={updateOf}
                    onChange={(event) => setUpdateOf(event.target.value)}
                    placeholder="column_name"
                    flat
                    className={cn(SHEET_CONTROL, "font-mono")}
                  />
                </SheetField>
              ) : null}
              <SheetField label="Function args">
                <Input
                  value={functionArgs}
                  onChange={(event) => setFunctionArgs(event.target.value)}
                  placeholder="optional"
                  flat
                  className={cn(SHEET_CONTROL, "font-mono")}
                />
              </SheetField>
              <SheetSwitchRow label="CONSTRAINT">
                <Switch
                  size="sm"
                  checked={constraint}
                  onCheckedChange={(checked) => {
                    setConstraint(checked);
                    if (!checked) setDefer(null);
                  }}
                  ariaLabel="CONSTRAINT trigger"
                />
              </SheetSwitchRow>
              {constraint ? (
                <SheetChoiceRow label="Defer">
                  {DEFERS.map((item) => (
                    <SheetChoice
                      key={item.id}
                      active={defer === item.id}
                      onClick={() => setDefer(defer === item.id ? null : item.id)}
                    >
                      {item.label}
                    </SheetChoice>
                  ))}
                </SheetChoiceRow>
              ) : null}
              <SheetPair>
                <SheetField label="OLD TABLE AS" split="start">
                  <Input
                    value={referencingOld}
                    onChange={(event) => setReferencingOld(event.target.value)}
                    placeholder="optional"
                    flat
                    className={cn(SHEET_CONTROL, "font-mono")}
                  />
                </SheetField>
                <SheetField label="NEW TABLE AS" split="end">
                  <Input
                    value={referencingNew}
                    onChange={(event) => setReferencingNew(event.target.value)}
                    placeholder="optional"
                    flat
                    className={cn(SHEET_CONTROL, "font-mono")}
                  />
                </SheetField>
              </SheetPair>
            </div>
          ) : null}
        </div>
        <div className="shrink-0 border-t border-border/50" data-slot="sql-trigger-sql-dock">
          <SheetChapter label="SQL" hint="Editable before it runs" />
          <SqlStyleEditor
            value={sql}
            onChange={setSql}
            onSubmit={isPending ? undefined : submit}
            label="CREATE TRIGGER SQL"
            className="min-h-36 max-h-48"
          />
          {error ? <SheetError slot="sql-trigger-error">{error}</SheetError> : null}
        </div>

        <SheetFooter>
          <SheetFooterButton split onClick={() => onOpenChange(false)}>
            Cancel
          </SheetFooterButton>
          <SheetFooterButton
            variant="default"
            disabled={isPending || !isCreateTriggerSql(sql)}
            onClick={submit}
            data-slot="sql-trigger-submit"
          >
            {isPending ? "Creating…" : "Create trigger"}
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
