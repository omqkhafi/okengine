/**
 * Create a Postgres function from the Functions catalog.
 */

import { useEffect, useState, type JSX, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FunctionIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Input } from "@/components/ui/input";
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
  buildCreateFunctionSql,
  extractFunctionBody,
  isCreateFunctionSql,
  sqlFunctionAdvancedCount,
  SQL_FUNCTION_TEMPLATES,
  type SqlFunctionLanguage,
  type SqlFunctionParallel,
  type SqlFunctionSecurity,
  type SqlFunctionTemplate,
  type SqlFunctionVolatility,
} from "../lib/sql-function.ts";

const LANGUAGES: readonly SqlFunctionLanguage[] = ["plpgsql", "sql"];
const VOLATILITIES: readonly SqlFunctionVolatility[] = ["VOLATILE", "STABLE", "IMMUTABLE"];
const SECURITIES: readonly SqlFunctionSecurity[] = ["INVOKER", "DEFINER"];
const PARALLELS: readonly SqlFunctionParallel[] = ["UNSAFE", "RESTRICTED", "SAFE"];

function defaultPlpgsqlBody(): string {
  return "BEGIN\n  -- Write your function logic here\nEND;";
}

/** Props for {@link SqlFunctionSheet}. */
export interface SqlFunctionSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly storeRef: string;
}

/**
 * Sheet to review and run `CREATE FUNCTION`.
 *
 * @param props - Store identity
 */
export function SqlFunctionSheet({
  open,
  onOpenChange,
  storeRef,
}: SqlFunctionSheetProps): JSX.Element {
  const qc = useQueryClient();
  const { mutate, isPending, reset } = useStoreSql();
  const [name, setName] = useState("");
  const [args, setArgs] = useState("");
  const [returns, setReturns] = useState("void");
  const [language, setLanguage] = useState<SqlFunctionLanguage>("plpgsql");
  const [volatility, setVolatility] = useState<SqlFunctionVolatility>("VOLATILE");
  const [orReplace, setOrReplace] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [security, setSecurity] = useState<SqlFunctionSecurity>("INVOKER");
  const [strict, setStrict] = useState(false);
  const [leakproof, setLeakproof] = useState(false);
  const [parallel, setParallel] = useState<SqlFunctionParallel>("UNSAFE");
  const [searchPath, setSearchPath] = useState("");
  const [cost, setCost] = useState("");
  const [rows, setRows] = useState("");
  const [sql, setSql] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);

  const rebuildSql = (
    next: {
      readonly name?: string;
      readonly args?: string;
      readonly returns?: string;
      readonly language?: SqlFunctionLanguage;
      readonly volatility?: SqlFunctionVolatility;
      readonly orReplace?: boolean;
      readonly body?: string;
      readonly security?: SqlFunctionSecurity;
      readonly strict?: boolean;
      readonly leakproof?: boolean;
      readonly parallel?: SqlFunctionParallel;
      readonly searchPath?: string;
      readonly cost?: string;
      readonly rows?: string;
    },
    currentSql = sql,
  ): void => {
    const nextName = next.name ?? name;
    const nextArgs = next.args ?? args;
    const nextReturns = next.returns ?? returns;
    const nextLanguage = next.language ?? language;
    const nextVolatility = next.volatility ?? volatility;
    const nextReplace = next.orReplace ?? orReplace;
    const nextSecurity = next.security ?? security;
    const nextStrict = next.strict ?? strict;
    const nextLeakproof = next.leakproof ?? leakproof;
    const nextParallel = next.parallel ?? parallel;
    const nextSearchPath = next.searchPath ?? searchPath;
    const nextCost = Number(next.cost ?? cost);
    const nextRows = Number(next.rows ?? rows);
    setSql(
      buildCreateFunctionSql({
        name: nextName.trim() || "function_name",
        args: nextArgs,
        returns: nextReturns,
        language: nextLanguage,
        volatility: nextVolatility,
        body: next.body ?? extractFunctionBody(currentSql) ?? defaultPlpgsqlBody(),
        orReplace: nextReplace,
        security: nextSecurity,
        strict: nextStrict,
        leakproof: nextLeakproof,
        parallel: nextParallel,
        ...(nextSearchPath.trim() !== "" ? { searchPath: nextSearchPath } : {}),
        ...(Number.isFinite(nextCost) && nextCost > 0 ? { cost: nextCost } : {}),
        ...(Number.isFinite(nextRows) && nextRows > 0 ? { rows: nextRows } : {}),
      }),
    );
  };

  useEffect(() => {
    if (!open) return;
    setName("");
    setArgs("");
    setReturns("void");
    setLanguage("plpgsql");
    setVolatility("VOLATILE");
    setOrReplace(false);
    setAdvanced(false);
    setSecurity("INVOKER");
    setStrict(false);
    setLeakproof(false);
    setParallel("UNSAFE");
    setSearchPath("");
    setCost("");
    setRows("");
    setTemplateId(null);
    setError(null);
    setSql(
      buildCreateFunctionSql({
        name: "function_name",
        args: "",
        returns: "void",
        language: "plpgsql",
        body: defaultPlpgsqlBody(),
      }),
    );
    reset();
  }, [open, reset]);

  const applyTemplate = (tpl: SqlFunctionTemplate): void => {
    setTemplateId(tpl.id);
    const nextName = name.trim() === "" ? tpl.id.replaceAll("-", "_") : name;
    setReturns(tpl.returns);
    setLanguage(tpl.language);
    setVolatility(tpl.volatility ?? "VOLATILE");
    setArgs(tpl.args ?? "");
    if (name.trim() === "") setName(nextName);
    rebuildSql(
      {
        name: nextName,
        args: tpl.args ?? "",
        returns: tpl.returns,
        language: tpl.language,
        volatility: tpl.volatility ?? "VOLATILE",
        body: tpl.body,
      },
      sql,
    );
  };

  const submit = (): void => {
    if (!isCreateFunctionSql(sql)) {
      setError("This sheet runs CREATE FUNCTION only");
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
        data-slot="sql-function-sheet"
        onKeyDown={onKeyDown}
      >
        <SheetHeader className="shrink-0 gap-2 border-b border-border/50">
          <div className="flex items-start gap-3">
            <div className="flex size-9 items-center justify-center rounded-full border border-border/50 bg-muted/20">
              <HugeiconsIcon icon={FunctionIcon} className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-sm">New function</SheetTitle>
              <SheetDescription className="text-[11px]">
                Review the `CREATE FUNCTION` SQL before it runs
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <CatalogTemplateStrip
            templates={SQL_FUNCTION_TEMPLATES}
            selectedId={templateId}
            onSelect={applyTemplate}
          />
          <SheetField label="Function name">
            <Input
              value={name}
              onChange={(event) => {
                const next = event.target.value;
                setName(next);
                rebuildSql({ name: next });
              }}
              placeholder="function_name"
              flat
              className={cn(SHEET_CONTROL, "font-mono")}
            />
          </SheetField>
          <SheetPair>
            <SheetField label="Arguments" split="start">
              <Input
                value={args}
                onChange={(event) => {
                  const next = event.target.value;
                  setArgs(next);
                  rebuildSql({ args: next });
                }}
                placeholder="optional — id text"
                flat
                className={cn(SHEET_CONTROL, "font-mono")}
              />
            </SheetField>
            <SheetField label="Returns" split="end">
              <Input
                value={returns}
                onChange={(event) => {
                  const next = event.target.value;
                  setReturns(next);
                  rebuildSql({ returns: next });
                }}
                placeholder="void"
                flat
                className={cn(SHEET_CONTROL, "font-mono")}
              />
            </SheetField>
          </SheetPair>
          <SheetChoiceRow label="Language">
            {LANGUAGES.map((item) => (
              <SheetChoice
                key={item}
                active={language === item}
                onClick={() => {
                  setLanguage(item);
                  rebuildSql({ language: item });
                }}
              >
                {item}
              </SheetChoice>
            ))}
          </SheetChoiceRow>
          <SheetChoiceRow label="Volatility">
            {VOLATILITIES.map((item) => (
              <SheetChoice
                key={item}
                active={volatility === item}
                onClick={() => {
                  setVolatility(item);
                  rebuildSql({ volatility: item });
                }}
              >
                {item}
              </SheetChoice>
            ))}
          </SheetChoiceRow>
          <SheetSwitchRow label="Replace if it already exists">
            <Switch
              size="sm"
              checked={orReplace}
              onCheckedChange={(checked) => {
                setOrReplace(checked);
                rebuildSql({ orReplace: checked });
              }}
              ariaLabel="Replace if it already exists"
            />
          </SheetSwitchRow>
          <SheetChapter label="Options">
            <CatalogAdvancedToggle
              open={advanced}
              extraCount={sqlFunctionAdvancedCount({
                security,
                strict,
                leakproof,
                parallel,
                searchPath,
                cost: Number(cost),
                rows: Number(rows),
              })}
              onOpenChange={setAdvanced}
              controls="sql-function-advanced"
            />
          </SheetChapter>
          {advanced ? (
            <div id="sql-function-advanced">
              <SheetChoiceRow label="Security">
                {SECURITIES.map((item) => (
                  <SheetChoice
                    key={item}
                    active={security === item}
                    onClick={() => {
                      setSecurity(item);
                      rebuildSql({ security: item });
                    }}
                  >
                    {item}
                  </SheetChoice>
                ))}
              </SheetChoiceRow>
              <SheetChoiceRow label="Parallel">
                {PARALLELS.map((item) => (
                  <SheetChoice
                    key={item}
                    active={parallel === item}
                    onClick={() => {
                      setParallel(item);
                      rebuildSql({ parallel: item });
                    }}
                  >
                    {item}
                  </SheetChoice>
                ))}
              </SheetChoiceRow>
              <SheetPair>
                <SheetSwitchRow label="STRICT" className="border-r border-b-0">
                  <Switch
                    size="sm"
                    checked={strict}
                    onCheckedChange={(checked) => {
                      setStrict(checked);
                      rebuildSql({ strict: checked });
                    }}
                    ariaLabel="STRICT"
                  />
                </SheetSwitchRow>
                <SheetSwitchRow label="LEAKPROOF" className="border-b-0">
                  <Switch
                    size="sm"
                    checked={leakproof}
                    onCheckedChange={(checked) => {
                      setLeakproof(checked);
                      rebuildSql({ leakproof: checked });
                    }}
                    ariaLabel="LEAKPROOF"
                  />
                </SheetSwitchRow>
              </SheetPair>
              <SheetField label="SET search_path">
                <Input
                  value={searchPath}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSearchPath(next);
                    rebuildSql({ searchPath: next });
                  }}
                  placeholder="public, pg_temp"
                  flat
                  className={cn(SHEET_CONTROL, "font-mono")}
                />
              </SheetField>
              <SheetPair>
                <SheetField label="COST" split="start">
                  <Input
                    value={cost}
                    onChange={(event) => {
                      const next = event.target.value;
                      setCost(next);
                      rebuildSql({ cost: next });
                    }}
                    placeholder="optional"
                    inputMode="decimal"
                    flat
                    className={cn(SHEET_CONTROL, "font-mono")}
                  />
                </SheetField>
                <SheetField label="ROWS" split="end">
                  <Input
                    value={rows}
                    onChange={(event) => {
                      const next = event.target.value;
                      setRows(next);
                      rebuildSql({ rows: next });
                    }}
                    placeholder="optional"
                    inputMode="decimal"
                    flat
                    className={cn(SHEET_CONTROL, "font-mono")}
                  />
                </SheetField>
              </SheetPair>
            </div>
          ) : null}
        </div>
        <div className="shrink-0 border-t border-border/50" data-slot="sql-function-sql-dock">
          <SheetChapter label="SQL" hint="Editable before it runs" />
          <SqlStyleEditor
            value={sql}
            onChange={setSql}
            onSubmit={isPending ? undefined : submit}
            label="CREATE FUNCTION SQL"
            className="min-h-36 max-h-48"
          />
          {error ? <SheetError slot="sql-function-error">{error}</SheetError> : null}
        </div>

        <SheetFooter>
          <SheetFooterButton split onClick={() => onOpenChange(false)}>
            Cancel
          </SheetFooterButton>
          <SheetFooterButton
            variant="default"
            disabled={isPending || !isCreateFunctionSql(sql)}
            onClick={submit}
            data-slot="sql-function-submit"
          >
            {isPending ? "Creating…" : "Create function"}
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
