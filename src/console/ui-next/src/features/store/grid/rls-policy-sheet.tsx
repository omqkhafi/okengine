/**
 * Create a Postgres RLS policy from the Console catalog.
 */

import { useId, useMemo, useState, type JSX, type ReactNode } from "react";
import {
  Cancel01Icon,
  FilterHorizontalIcon,
  Key01Icon,
  LeftToRightListBulletIcon,
  PencilEdit01Icon,
  Search01Icon,
  SecurityCheckIcon,
  Tick02Icon,
  UserIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AgentCode } from "@/components/agents/agent-code";
import { EXPLORER_ICON_BUTTON_CLASS } from "@/components/explorer/explorer-chrome.ts";
import { Input } from "@/components/ui/input";
import {
  SHEET_CONTROL,
  SHEET_SEARCH,
  SheetChapter,
  SheetChoice,
  SheetChoiceRow,
  SheetError,
  SheetField,
  SheetFooterButton,
  SheetPair,
  SheetTextToggle,
} from "@/components/ui/sheet-form.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select.tsx";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Switch } from "@/components/motion/switch.tsx";
import { LayoutGroup, motion, useReducedMotion } from "@/lib/motion.ts";
import { SPRING_LAYOUT } from "@/lib/ease.ts";
import { cn } from "@/lib/utils.ts";
import { SchemaColumnMarks } from "../schema/schema-constraint-icon.tsx";
import type { Manifest } from "../../../../../../manifest/types.ts";
import { useGates } from "../data/use-gates.ts";
import { useStoreEdit } from "../data/use-store-edit.ts";
import {
  filterRlsGateCatalog,
  mergeRlsGateCatalog,
  rlsCatalogPolicies,
  rlsCatalogScopes,
  rlsGateCatalog,
  rlsGateSelectionExtraCount,
  rlsSyncActionsForCommand,
  type RlsCatalogGate,
  type RlsGateCatalog,
  type RlsGateSelection,
  type RlsGateVariant,
} from "../lib/rls-gate-catalog.ts";
import {
  filterRlsPolicyTemplates,
  parseSqlPolicySpec,
  RLS_POLICY_COMMANDS,
  RLS_POLICY_TEMPLATES,
  rlsBindOwnerExpr,
  rlsCommandFromGateMode,
  rlsExprNeedsOwnerColumn,
  rlsExprUsesUserIdentity,
  rlsGateActionsForMode,
  rlsGateModeFromCommand,
  rlsOwnerColumn,
  rlsPolicyPredicates,
  rlsPolicyPreviewSql,
  rlsPolicyCodeSource,
  rlsRewriteIdentityColumn,
  rlsGatePredicateSql,
  rlsTableColumns,
  rlsTableSqlColumns,
  rlsTemplateUsesOwner,
  type RlsGateMode,
  type RlsPolicyTemplate,
  type SqlPolicyBehavior,
  type SqlPolicyCommand,
} from "../lib/rls-policy.ts";

const WRITE_COMMANDS: readonly SqlPolicyCommand[] = ["INSERT", "UPDATE", "DELETE"];

const GATE_MODES: readonly {
  readonly id: RlsGateMode;
  readonly label: string;
  readonly icon: typeof ViewIcon;
}[] = [
  { id: "read", label: "Read", icon: ViewIcon },
  { id: "write", label: "Write", icon: PencilEdit01Icon },
  { id: "both", label: "Both", icon: SecurityCheckIcon },
];

/** Props for {@link RlsPolicySheet}. */
export interface RlsPolicySheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly storeRef: string;
  readonly tables: readonly string[];
  readonly manifest?: Manifest | null;
}

/**
 * Sheet to review and run `CREATE POLICY` (and optionally enable RLS).
 *
 * @param props - Store + table names + Manifest
 */
export function RlsPolicySheet({
  open,
  onOpenChange,
  storeRef,
  tables,
  manifest = null,
}: RlsPolicySheetProps): JSX.Element {
  const edit = useStoreEdit();
  const gatesQuery = useGates(open);
  const [name, setName] = useState("");
  const [dock, setDock] = useState<"sql" | "code">("sql");
  const [table, setTable] = useState(tables[0] ?? "");
  const [identityCol, setIdentityCol] = useState("");
  const [command, setCommand] = useState<SqlPolicyCommand>("SELECT");
  const [behavior, setBehavior] = useState<SqlPolicyBehavior>("PERMISSIVE");
  const [using, setUsing] = useState("true");
  const [withCheck, setWithCheck] = useState("true");
  const [enableRls, setEnableRls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [templateQuery, setTemplateQuery] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [gateQuery, setGateQuery] = useState("");
  const [selectedGates, setSelectedGates] = useState<readonly string[]>([]);
  const [selectedActions, setSelectedActions] = useState<readonly string[]>(() =>
    rlsGateActionsForMode("read"),
  );
  const gateMode = rlsGateModeFromCommand(command);
  const predicates = rlsPolicyPredicates(command);
  const tableColumns = useMemo(
    () => rlsTableColumns(manifest, storeRef, table),
    [manifest, storeRef, table],
  );
  const sqlColumns = useMemo(() => tableColumns.map((col) => col.sqlName), [tableColumns]);
  const suggestedCol = rlsOwnerColumn(sqlColumns);
  const identityValue =
    identityCol !== "" && sqlColumns.includes(identityCol) ? identityCol : (suggestedCol ?? "");
  const ownerStyle =
    (templateId !== null &&
      rlsTemplateUsesOwner(RLS_POLICY_TEMPLATES.find((tpl) => tpl.id === templateId) ?? {})) ||
    (predicates.using && rlsExprUsesUserIdentity(using)) ||
    (predicates.withCheck && rlsExprUsesUserIdentity(withCheck));
  const showIdentitySelect = sqlColumns.length > 0 && ownerStyle;
  const ownerUnbound =
    ((predicates.using && rlsExprNeedsOwnerColumn(using)) ||
      (predicates.withCheck && rlsExprNeedsOwnerColumn(withCheck))) &&
    identityValue === "";
  const catalog = useMemo(
    () => mergeRlsGateCatalog(rlsGateCatalog(manifest), gatesQuery.data ?? null),
    [manifest, gatesQuery.data],
  );
  const selection: RlsGateSelection = useMemo(
    () => ({ gates: selectedGates, actions: selectedActions, roles: [] }),
    [selectedGates, selectedActions],
  );

  const preview = useMemo(() => {
    try {
      const spec = parseSqlPolicySpec({
        name: name || "policy_name",
        table: table || "table",
        command,
        behavior,
        roles: "public",
        using: predicates.using ? using : "",
        withCheck: predicates.withCheck ? withCheck : "",
      });
      return {
        sql: rlsPolicyPreviewSql(spec, enableRls),
        code: rlsPolicyCodeSource(spec),
      };
    } catch {
      return null;
    }
  }, [name, table, command, behavior, predicates, using, withCheck, enableRls]);

  const bindIdentity = (expr: string, col: string): string =>
    col !== "" ? rlsBindOwnerExpr(expr, col) : expr;

  const applyTemplate = (tpl: RlsPolicyTemplate): void => {
    const col = rlsTemplateUsesOwner(tpl) ? identityValue : "";
    setTemplateId(tpl.id);
    setName(tpl.name);
    setCommand(tpl.command);
    setBehavior(tpl.behavior ?? "PERMISSIVE");
    setSelectedActions((prev) => rlsSyncActionsForCommand(prev, tpl.command));
    setUsing(bindIdentity(tpl.using ?? "true", col));
    setWithCheck(bindIdentity(tpl.withCheck ?? "true", col));
    if (col !== "") setIdentityCol(col);
  };

  const setPolicyTable = (next: string): void => {
    const nextCols = rlsTableSqlColumns(manifest, storeRef, next);
    const nextCol =
      (identityCol !== "" && nextCols.includes(identityCol) ? identityCol : null) ??
      rlsOwnerColumn(nextCols) ??
      "";
    setTable(next);
    setIdentityCol(nextCol);
    const from = identityValue || "owner";
    setUsing((prev) => rlsRewriteIdentityColumn(prev, from, nextCol));
    setWithCheck((prev) => rlsRewriteIdentityColumn(prev, from, nextCol));
  };

  const setIdentityColumn = (next: string): void => {
    const from = identityValue || "owner";
    setIdentityCol(next);
    setUsing((prev) => rlsRewriteIdentityColumn(prev, from, next));
    setWithCheck((prev) => rlsRewriteIdentityColumn(prev, from, next));
  };

  const setGateMode = (next: RlsGateMode): void => {
    const nextCommand = rlsCommandFromGateMode(next, command);
    setCommand(nextCommand);
    setSelectedActions(rlsGateActionsForMode(next));
    setSelectedGates([]);
  };

  const setPolicyCommand = (next: SqlPolicyCommand): void => {
    setCommand(next);
    setSelectedActions((prev) => rlsSyncActionsForCommand(prev, next));
  };

  const toggleGate = (id: string): void => {
    setSelectedGates((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      const expr = rlsGatePredicateSql(next);
      setUsing(expr);
      setWithCheck(expr);
      return next;
    });
  };

  const submit = async (): Promise<void> => {
    setError(null);
    if (ownerUnbound) {
      setError(`Pick a column on ${table} that stores the user id.`);
      return;
    }
    try {
      const spec = parseSqlPolicySpec({
        name,
        table,
        command,
        behavior,
        roles: "public",
        using: predicates.using ? using : "",
        withCheck: predicates.withCheck ? withCheck : "",
      });
      await edit.mutateAsync({
        ref: storeRef,
        child: "policies",
        id: `${spec.table}:${spec.name}`,
        patch: {
          create: true,
          name: spec.name,
          table: spec.table,
          command: spec.command,
          behavior: spec.behavior,
          roles: spec.roles.join(", "),
          ...(spec.using !== undefined ? { using: spec.using } : {}),
          ...(spec.withCheck !== undefined ? { withCheck: spec.withCheck } : {}),
          enableRls,
        },
        commit: true,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setTemplatesOpen(false);
        onOpenChange(next);
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex-col gap-0 overflow-hidden rounded-none bg-popover p-0 shadow-lg sm:flex-row sm:items-stretch data-[side=right]:w-auto data-[side=right]:max-w-[calc(100vw-1.5rem)] data-[side=right]:sm:max-w-none"
        data-slot="rls-policy-sheet"
      >
        <div
          className="relative flex min-h-0 w-full flex-1 flex-col sm:w-[28rem] sm:flex-none"
          data-slot="rls-policy-form-sheet"
        >
          <SheetHeader className="flex-row items-stretch gap-0 border-b border-border/60 p-0">
            <div className="flex min-w-0 flex-1 items-start gap-3 p-4">
              <div className="flex size-9 items-center justify-center rounded-full border border-border/50 bg-muted/20">
                <HugeiconsIcon icon={SecurityCheckIcon} className="size-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-sm">Create policy</SheetTitle>
                <SheetDescription className="text-[11px]">
                  Review the `CREATE POLICY` SQL before it runs
                </SheetDescription>
              </div>
            </div>
            <span className="w-px shrink-0 self-stretch bg-border/60" aria-hidden />
            <SheetClose
              className={cn(EXPLORER_ICON_BUTTON_CLASS, "min-w-11")}
              data-slot="rls-policy-form-close"
              aria-label="Close"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-4" aria-hidden />
              <span className="sr-only">Close</span>
            </SheetClose>
          </SheetHeader>
          <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
            <ResizablePanel defaultSize="68%" minSize="28%" className="min-h-0">
              <div className="h-full min-h-0 overflow-y-auto" data-slot="rls-policy-form-scroll">
                <div className="border-b border-border/50">
                  <div className="flex items-center justify-between gap-2 px-4 pt-2.5">
                    <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                      Policy name
                    </p>
                    <SheetTextToggle
                      active={templatesOpen}
                      aria-expanded={templatesOpen}
                      aria-controls={templatesOpen ? "rls-policy-templates-sheet" : undefined}
                      onClick={() => setTemplatesOpen((open) => !open)}
                    >
                      <HugeiconsIcon
                        icon={LeftToRightListBulletIcon}
                        className="size-3"
                        aria-hidden
                      />
                      Templates
                    </SheetTextToggle>
                  </div>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="read_all"
                    aria-label="Policy name"
                    flat
                    className={cn(SHEET_CONTROL, "font-mono")}
                  />
                </div>
                <SheetPair>
                  <SheetField label="Table" split="start">
                    <Select value={table} onValueChange={setPolicyTable}>
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
                  <SheetField label="Behavior" split="end">
                    <Select
                      value={behavior}
                      onValueChange={(next) => setBehavior(next as SqlPolicyBehavior)}
                    >
                      <SelectTrigger flat className={SHEET_CONTROL}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PERMISSIVE">Permissive</SelectItem>
                        <SelectItem value="RESTRICTIVE">Restrictive</SelectItem>
                      </SelectContent>
                    </Select>
                  </SheetField>
                </SheetPair>
                <SheetChapter label="Gate" hint="Who this policy pairs with" />
                <GateSection
                  advanced={advanced}
                  onAdvancedChange={setAdvanced}
                  mode={gateMode}
                  onModeChange={setGateMode}
                  catalog={catalog}
                  query={gateQuery}
                  onQueryChange={setGateQuery}
                  selection={selection}
                  onToggleGate={toggleGate}
                />
                {advanced || gateMode === "write" ? (
                  <CommandRow
                    commands={advanced ? RLS_POLICY_COMMANDS : WRITE_COMMANDS}
                    value={command}
                    onChange={setPolicyCommand}
                  />
                ) : null}
                <SheetChapter
                  label="Rows"
                  hint={
                    predicates.using && predicates.withCheck
                      ? "Existing rows and new rows"
                      : predicates.withCheck
                        ? "New rows"
                        : "Existing rows"
                  }
                />
                {showIdentitySelect ? (
                  <SheetField label="Column" hint="compared to oke.user()">
                    <Select value={identityValue} onValueChange={setIdentityColumn}>
                      <SelectTrigger
                        flat
                        className={cn(SHEET_CONTROL, "font-mono")}
                        data-slot="rls-identity-column"
                      >
                        <SelectValue placeholder="Select a column" />
                      </SelectTrigger>
                      <SelectContent>
                        {tableColumns.map((col) => (
                          <SelectItem key={col.sqlName} value={col.sqlName}>
                            <span className="flex min-w-0 items-center gap-2">
                              <SchemaColumnMarks
                                primaryKey={col.primaryKey}
                                foreignKey={col.foreignKey}
                                unique={col.unique}
                                inferred={col.inferred}
                              />
                              <span className="min-w-0 truncate font-mono text-[12px]">
                                {col.sqlName}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </SheetField>
                ) : null}
                {predicates.using ? (
                  <SheetField label="USING">
                    <Input
                      value={using}
                      onChange={(event) => setUsing(event.target.value)}
                      placeholder="true"
                      flat
                      className={cn(SHEET_CONTROL, "font-mono")}
                    />
                  </SheetField>
                ) : null}
                {predicates.withCheck ? (
                  <SheetField label="WITH CHECK">
                    <Input
                      value={withCheck}
                      onChange={(event) => setWithCheck(event.target.value)}
                      placeholder="true"
                      flat
                      className={cn(SHEET_CONTROL, "font-mono")}
                    />
                  </SheetField>
                ) : null}
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle data-slot="rls-policy-sql-handle" />
            <ResizablePanel defaultSize="32%" minSize="16%" className="min-h-0">
              <div
                className="flex h-full min-h-0 flex-col bg-muted/15"
                data-slot="rls-policy-sql-dock"
              >
                <div className="flex items-center justify-between gap-3 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={cn(
                        "text-[10px] font-semibold tracking-[0.12em] uppercase",
                        dock === "sql" ? "text-foreground" : "text-muted-foreground",
                      )}
                      onClick={() => setDock("sql")}
                    >
                      SQL
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "text-[10px] font-semibold tracking-[0.12em] uppercase",
                        dock === "code" ? "text-foreground" : "text-muted-foreground",
                      )}
                      onClick={() => setDock("code")}
                    >
                      Code
                    </button>
                  </div>
                  <label className="inline-flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">Enable RLS</span>
                    <Switch
                      size="sm"
                      checked={enableRls}
                      onCheckedChange={setEnableRls}
                      ariaLabel="Enable RLS on this table"
                    />
                  </label>
                </div>
                {preview ? (
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
                    <AgentCode
                      code={dock === "sql" ? preview.sql : preview.code}
                      language={dock === "sql" ? "sql" : "typescript"}
                      className="overflow-visible whitespace-pre-wrap break-words text-[11px] leading-relaxed"
                    />
                  </div>
                ) : (
                  <p className="min-h-0 flex-1 px-4 pb-3 text-[11px] text-muted-foreground">
                    Fill name, table, and an expression.
                  </p>
                )}
                {ownerUnbound ? (
                  <SheetError slot="rls-owner-missing">
                    Pick a column on {table} — this table has no owner / owner_email / creator_email
                    guess.
                  </SheetError>
                ) : null}
                {error ? <SheetError>{error}</SheetError> : null}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
          <SheetFooter>
            <SheetFooterButton split onClick={() => onOpenChange(false)}>
              Cancel
            </SheetFooterButton>
            <SheetFooterButton
              variant="default"
              disabled={edit.isPending || !preview || ownerUnbound}
              onClick={() => void submit()}
            >
              {edit.isPending ? "Creating…" : "Create policy"}
            </SheetFooterButton>
          </SheetFooter>
        </div>
        {templatesOpen ? (
          <aside
            id="rls-policy-templates-sheet"
            className="flex h-80 w-full shrink-0 flex-col border-t border-border/50 sm:h-auto sm:w-80 sm:border-t-0 sm:border-l"
            data-slot="rls-policy-templates-sheet"
          >
            <PolicyTemplateLibrary
              query={templateQuery}
              onQueryChange={setTemplateQuery}
              selectedId={templateId}
              onSelect={applyTemplate}
              onClose={() => setTemplatesOpen(false)}
            />
          </aside>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

const COMMAND_TONE: Readonly<Record<SqlPolicyCommand, string>> = {
  SELECT: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  INSERT: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  UPDATE: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  DELETE: "bg-rose-500/15 text-rose-800 dark:text-rose-300",
  ALL: "bg-muted text-muted-foreground",
};

function PolicyTemplateLibrary({
  query,
  onQueryChange,
  selectedId,
  onSelect,
  onClose,
}: {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly selectedId: string | null;
  readonly onSelect: (tpl: RlsPolicyTemplate) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const visible = filterRlsPolicyTemplates(RLS_POLICY_TEMPLATES, query);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-slot="rls-policy-templates">
      <div className="flex shrink-0 items-stretch border-b border-border/60">
        <div className="min-w-0 flex-1">
          <p className="px-3 pt-2.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Templates
          </p>
          <label className="relative block">
            <HugeiconsIcon
              icon={Search01Icon}
              className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search templates"
              aria-label="Search templates"
              flat
              className={cn(SHEET_SEARCH, "font-mono")}
            />
          </label>
        </div>
        <span className="w-px shrink-0 self-stretch bg-border/60" aria-hidden />
        <button
          type="button"
          className={cn(EXPLORER_ICON_BUTTON_CLASS, "min-w-11")}
          onClick={onClose}
          aria-label="Close templates"
          data-slot="rls-policy-templates-close"
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-4" aria-hidden />
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {visible.length === 0 ? (
          <li className="px-2 py-3 text-[10px] text-muted-foreground">No matching templates.</li>
        ) : (
          visible.map((tpl) => {
            const selected = tpl.id === selectedId;
            return (
              <li key={tpl.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(tpl)}
                  className={cn(
                    "flex w-full flex-col gap-1.5 rounded-lg px-2.5 py-2 text-left",
                    selected ? "bg-muted ring-1 ring-foreground" : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-px font-mono text-[9px] font-semibold tracking-wide",
                        COMMAND_TONE[tpl.command],
                      )}
                    >
                      {tpl.command}
                    </span>
                    {tpl.behavior === "RESTRICTIVE" ? (
                      <span className="rounded border border-border/60 px-1 py-px text-[9px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                        Restrictive
                      </span>
                    ) : null}
                    {selected ? (
                      <HugeiconsIcon icon={Tick02Icon} className="ml-auto size-3.5 shrink-0" />
                    ) : null}
                  </span>
                  <span className="text-[12px] font-medium text-foreground">{tpl.title}</span>
                  <span className="text-[10px] leading-snug text-muted-foreground">
                    {tpl.detail}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function GateSection({
  advanced,
  onAdvancedChange,
  mode,
  onModeChange,
  catalog,
  query,
  onQueryChange,
  selection,
  onToggleGate,
}: {
  readonly advanced: boolean;
  readonly onAdvancedChange: (open: boolean) => void;
  readonly mode: RlsGateMode;
  readonly onModeChange: (mode: RlsGateMode) => void;
  readonly catalog: RlsGateCatalog;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly selection: RlsGateSelection;
  readonly onToggleGate: (id: string) => void;
}): JSX.Element {
  const extraCount = rlsGateSelectionExtraCount(selection);
  return (
    <div className={cn(!advanced && "border-b border-border/50")}>
      <GateModeRow
        mode={mode}
        onChange={onModeChange}
        advanced={advanced}
        extraCount={extraCount}
        onAdvancedChange={onAdvancedChange}
      />
      {advanced ? (
        <GateAdvancedPanel
          catalog={catalog}
          query={query}
          onQueryChange={onQueryChange}
          selection={selection}
          onToggleGate={onToggleGate}
        />
      ) : null}
    </div>
  );
}

function GateModeRow({
  mode,
  onChange,
  advanced,
  extraCount,
  onAdvancedChange,
}: {
  readonly mode: RlsGateMode;
  readonly onChange: (mode: RlsGateMode) => void;
  readonly advanced: boolean;
  readonly extraCount: number;
  readonly onAdvancedChange: (open: boolean) => void;
}): JSX.Element {
  const groupId = useId();
  const reduceMotion = useReducedMotion();
  return (
    <LayoutGroup id={groupId}>
      <div
        role="group"
        aria-label="Gate"
        className={cn("flex w-full items-center", advanced && "border-b border-border/50")}
      >
        {GATE_MODES.map((option) => {
          const active = !advanced && mode === option.id;
          return (
            <GateModeButton
              key={option.id}
              active={active}
              reduceMotion={reduceMotion}
              onClick={() => {
                onAdvancedChange(false);
                onChange(option.id);
              }}
            >
              <HugeiconsIcon icon={option.icon} className="size-3.5" aria-hidden />
              {option.label}
            </GateModeButton>
          );
        })}
        <GateModeButton
          active={advanced}
          reduceMotion={reduceMotion}
          aria-expanded={advanced}
          aria-controls="rls-gate-advanced"
          onClick={() => onAdvancedChange(!advanced)}
        >
          <HugeiconsIcon icon={FilterHorizontalIcon} className="size-3.5" aria-hidden />
          Advanced
          {extraCount > 0 ? (
            <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground/10 px-1 text-[9px] font-semibold tabular-nums">
              {extraCount}
            </span>
          ) : null}
        </GateModeButton>
      </div>
    </LayoutGroup>
  );
}

function GateModeButton({
  active,
  reduceMotion,
  onClick,
  children,
  ...props
}: {
  readonly active: boolean;
  readonly reduceMotion: boolean | null;
  readonly onClick: () => void;
  readonly children: ReactNode;
} & Omit<
  JSX.IntrinsicElements["button"],
  "type" | "onClick" | "children" | "className"
>): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-none px-2 text-[11px] font-medium outline-none select-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
      {...props}
    >
      {active ? (
        <motion.span
          layoutId="rls-gate-pill"
          className="absolute inset-0 z-0 bg-muted"
          style={{ borderRadius: 0 }}
          transition={reduceMotion ? { duration: 0 } : SPRING_LAYOUT}
        />
      ) : null}
      <span className="relative z-10 inline-flex items-center gap-1.5">{children}</span>
    </button>
  );
}

const FOR_DETAILS: Readonly<Record<SqlPolicyCommand, string>> = {
  SELECT: "USING on existing rows",
  INSERT: "WITH CHECK on new rows",
  UPDATE: "USING and WITH CHECK",
  DELETE: "USING on existing rows",
  ALL: "Every command",
};

function GateAdvancedPanel({
  catalog,
  query,
  onQueryChange,
  selection,
  onToggleGate,
}: {
  readonly catalog: RlsGateCatalog;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly selection: RlsGateSelection;
  readonly onToggleGate: (id: string) => void;
}): JSX.Element {
  const visible = filterRlsGateCatalog(catalog, query);
  const policies = rlsCatalogPolicies(visible);
  const scopes = rlsCatalogScopes(visible);
  const searching = query.trim() !== "";
  return (
    <div id="rls-gate-advanced" className="flex flex-col">
      <label className="relative block border-b border-border/50">
        <HugeiconsIcon
          icon={Search01Icon}
          className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search policy or scope"
          aria-label="Search policy or scope"
          flat
          className={cn(SHEET_SEARCH, "font-mono")}
        />
      </label>
      {selection.gates.length > 0 ? (
        <div className="flex flex-wrap gap-1 border-b border-border/50 px-4 py-1.5">
          {selection.gates.map((gate) => (
            <button
              key={gate}
              type="button"
              onClick={() => onToggleGate(gate)}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground hover:bg-muted/70"
              aria-label={`Remove ${gate}`}
            >
              {gate}
              <HugeiconsIcon icon={Cancel01Icon} className="size-2.5" aria-hidden />
            </button>
          ))}
        </div>
      ) : null}
      <CatalogList
        empty={searching ? "No matches." : "No policy or scope gates declared."}
        hasRows={policies.length + scopes.length > 0}
      >
        {policies.length > 0 ? <CatalogGroupHeader label="Policy" hint="gate.policy" /> : null}
        {policies.map((gate) => (
          <CatalogPickRow
            key={gate.name}
            icon={gateVariantIcon(gate.variant)}
            label={gate.name}
            detail={gateRowDetail(gate)}
            selected={selection.gates.includes(gate.name)}
            onSelect={() => onToggleGate(gate.name)}
            pressed
          />
        ))}
        {scopes.length > 0 ? <CatalogGroupHeader label="Scope" hint="gate.scope" /> : null}
        {scopes.map((gate) => (
          <CatalogPickRow
            key={gate.name}
            icon={gateVariantIcon(gate.variant)}
            label={gate.name}
            detail={gateRowDetail(gate)}
            selected={selection.gates.includes(gate.name)}
            onSelect={() => onToggleGate(gate.name)}
            pressed
          />
        ))}
      </CatalogList>
    </div>
  );
}

function CatalogList({
  empty,
  hasRows,
  children,
}: {
  readonly empty: string;
  readonly hasRows: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  return hasRows ? (
    <ul className="max-h-40 overflow-y-auto border-b border-border/50">{children}</ul>
  ) : (
    <p className="border-b border-border/50 px-4 py-3 text-[10px] text-muted-foreground">{empty}</p>
  );
}

function CatalogGroupHeader({
  label,
  hint,
}: {
  readonly label: string;
  readonly hint: string;
}): JSX.Element {
  return (
    <li className="sticky top-0 z-10 border-b border-border/50 bg-muted/80 px-4 py-1 backdrop-blur-sm">
      <p className="flex items-baseline gap-2 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
        <span className="font-mono font-normal tracking-normal text-muted-foreground/70 lowercase">
          {hint}
        </span>
      </p>
    </li>
  );
}

function CatalogPickRow({
  icon,
  label,
  detail,
  selected,
  onSelect,
  pressed = false,
}: {
  readonly icon: typeof SecurityCheckIcon;
  readonly label: string;
  readonly detail: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly pressed?: boolean;
}): JSX.Element {
  return (
    <li className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        role={pressed ? "checkbox" : "radio"}
        aria-checked={selected}
        aria-pressed={pressed ? selected : undefined}
        onClick={onSelect}
        className={cn(
          "flex w-full items-start gap-2 px-4 py-1.5 text-left",
          selected ? "bg-muted" : "hover:bg-muted/40",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm",
            selected ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          <HugeiconsIcon icon={icon} className="size-3" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[12px] font-medium text-foreground">
            {label}
          </span>
          <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
            {detail}
          </span>
        </span>
        {selected ? (
          <HugeiconsIcon icon={Tick02Icon} className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        ) : null}
      </button>
    </li>
  );
}

function gateVariantIcon(variant: RlsGateVariant): typeof SecurityCheckIcon {
  if (variant === "public") return UserIcon;
  if (variant === "scope") return Key01Icon;
  return SecurityCheckIcon;
}

function gateRowDetail(gate: RlsCatalogGate): string {
  if (gate.description) return gate.description;
  if (gate.variant === "public") return "Intentionally unauthenticated";
  if (gate.variant === "scope") return `auth.scopes.has("${gate.name}")`;
  return "ABAC policy";
}

function CommandRow({
  commands,
  value,
  onChange,
}: {
  readonly commands: readonly SqlPolicyCommand[];
  readonly value: SqlPolicyCommand;
  readonly onChange: (command: SqlPolicyCommand) => void;
}): JSX.Element {
  return (
    <SheetChoiceRow label="FOR" hint={FOR_DETAILS[value]}>
      {commands.map((item) => (
        <SheetChoice key={item} active={value === item} onClick={() => onChange(item)}>
          {item}
        </SheetChoice>
      ))}
    </SheetChoiceRow>
  );
}
