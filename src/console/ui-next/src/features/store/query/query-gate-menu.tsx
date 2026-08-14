/**
 * Query-console Gate picker — Operator, public, or a selected user / policy.
 */

import { useMemo, useState, type JSX, type ReactNode } from "react";
import { Search01Icon, SecurityCheckIcon, Tick02Icon, UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Manifest } from "../../../../../../manifest/types.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils.ts";
import { useFlowsIdentities } from "@/features/units/data/use-flows-invoke.ts";
import { useGates } from "../data/use-gates.ts";
import {
  filterQueryGateAsChoices,
  queryGateMode,
  queryGatePolicyChoices,
  queryGateToolbarLabel,
  queryGateUserChoices,
  type QueryGateMode,
  type QueryGatePolicyChoice,
  type QueryGateUserChoice,
} from "../lib/query-gate.ts";
import { mergeRlsGateCatalog, rlsGateCatalog } from "../lib/rls-gate-catalog.ts";
import { QueryGateViz } from "./query-gate-viz.tsx";

/** Props for {@link QueryGateMenu}. */
export interface QueryGateMenuProps {
  readonly manifest: Manifest | null;
  readonly asGate: string | null;
  readonly onChange: (asGate: string | null) => void;
}

type AsTab = "user" | "policy";

/**
 * Toolbar control: view SQL results as Operator, public, a user, or a Gate.
 *
 * @param props - Manifest + current pick
 */
export function QueryGateMenu({ manifest, asGate, onChange }: QueryGateMenuProps): JSX.Element {
  const gatesQuery = useGates(true);
  const identitiesQuery = useFlowsIdentities();
  const catalog = useMemo(
    () => mergeRlsGateCatalog(rlsGateCatalog(manifest), gatesQuery.data ?? null),
    [manifest, gatesQuery.data],
  );
  const policies = useMemo(() => queryGatePolicyChoices(catalog), [catalog]);
  const users = useMemo(
    () => queryGateUserChoices(identitiesQuery.data ?? [], catalog),
    [identitiesQuery.data, catalog],
  );
  const publicDetail =
    catalog.gates.find((gate) => gate.kind === "public")?.description ??
    "Intentionally unauthenticated.";
  const mode = queryGateMode(asGate);
  const active = asGate !== null;
  const [asUserId, setAsUserId] = useState<string | null>(null);
  const [asTab, setAsTab] = useState<AsTab>("policy");
  const selectedPolicy = policies.find((policy) => policy.id === asGate) ?? null;
  const selectedUser = users.find((user) => user.id === asUserId && user.gate === asGate) ?? null;
  const asEnabled = policies.length > 0 || users.length > 0;

  const selectMode = (next: QueryGateMode): void => {
    if (next === "operator") {
      setAsUserId(null);
      onChange(null);
      return;
    }
    if (next === "public") {
      setAsUserId(null);
      onChange("public");
      return;
    }
    if (mode === "as") return;
    const fallback = selectedPolicy?.id ?? policies[0]?.id ?? users[0]?.gate ?? null;
    if (fallback === null) return;
    if (users[0] && fallback === users[0].gate && policies.length === 0) {
      setAsUserId(users[0].id);
      setAsTab("user");
    } else {
      setAsTab("policy");
    }
    onChange(fallback);
  };

  const selectPolicy = (policy: QueryGatePolicyChoice): void => {
    setAsUserId(null);
    setAsTab("policy");
    onChange(policy.id);
  };

  const selectUser = (user: QueryGateUserChoice): void => {
    setAsUserId(user.id);
    setAsTab("user");
    onChange(user.gate);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(props) => (
          <Button
            {...props}
            type="button"
            variant={active ? "secondary" : "ghost"}
            size="sm"
            className={cn("h-7 text-[11px]", active && "text-sky-800 dark:text-sky-300")}
            aria-label={active ? `View data as Gate ${asGate}` : "View data as Operator (default)"}
            data-slot="store-query-gate"
          >
            <HugeiconsIcon icon={SecurityCheckIcon} data-icon="inline-start" className="size-3.5" />
            {queryGateToolbarLabel(asGate)}
          </Button>
        )}
      />
      <DropdownMenuContent align="start" className="w-[26rem] p-2.5">
        <p className="px-0.5 pb-2 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
          View data as a Gate
        </p>
        <div role="radiogroup" aria-label="View data as" className="grid grid-cols-3 gap-1.5">
          <GateCard
            mode="operator"
            title="Operator"
            caption="Bypass"
            selected={mode === "operator"}
            onSelect={() => selectMode("operator")}
          />
          <GateCard
            mode="public"
            title="Public"
            caption="Anonymous"
            selected={mode === "public"}
            onSelect={() => selectMode("public")}
          />
          <GateCard
            mode="as"
            title="As"
            caption={selectedUser ? selectedUser.label : (selectedPolicy?.label ?? "User / policy")}
            selected={mode === "as"}
            disabled={!asEnabled}
            onSelect={() => selectMode("as")}
          />
        </div>
        <div className="mt-2.5 border-t border-border/60 pt-2.5">
          {mode === "operator" ? (
            <GateDetail title="Full admin access" badge="Default">
              Operator bypasses Row Level Security. Omit <span className="font-mono">asGate</span> —
              no <span className="font-mono">oke.gate</span> is set.
            </GateDetail>
          ) : null}
          {mode === "public" ? (
            <GateDetail title="Public">
              {publicDetail} Sets <span className="font-mono">oke.gate</span> to{" "}
              <span className="font-mono">public</span> so policies can use{" "}
              <span className="font-mono">current_setting('oke.gate', true)</span>.
            </GateDetail>
          ) : null}
          {mode === "as" ? (
            <AsPicker
              tab={asTab}
              onTabChange={setAsTab}
              policies={policies}
              users={users}
              asGate={asGate}
              asUserId={selectedUser?.id ?? null}
              onSelectPolicy={selectPolicy}
              onSelectUser={selectUser}
            />
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GateCard({
  mode,
  title,
  caption,
  selected,
  disabled = false,
  onSelect,
}: {
  readonly mode: QueryGateMode;
  readonly title: string;
  readonly caption: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      data-slot="store-query-gate-card"
      data-mode={mode}
      className={cn(
        "relative flex flex-col gap-1.5 rounded-lg px-2 pt-2 pb-1.5 text-left ring-1 transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
        selected
          ? "bg-background ring-foreground"
          : "ring-border/70 hover:bg-muted/40 hover:ring-border",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      {selected ? (
        <span
          className="absolute top-1.5 right-1.5 flex size-3.5 items-center justify-center rounded-full bg-foreground text-background"
          aria-hidden
        >
          <HugeiconsIcon icon={Tick02Icon} className="size-2.5" />
        </span>
      ) : null}
      <QueryGateViz mode={mode} active={selected} />
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-medium text-foreground">{title}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{caption}</span>
      </span>
    </button>
  );
}

function GateDetail({
  title,
  badge,
  children,
}: {
  readonly title: string;
  readonly badge?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div className="px-0.5" data-slot="store-query-gate-detail">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
        {title}
        {badge ? (
          <span className="rounded border border-border/60 px-1 py-px text-[9px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {badge}
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

function AsPicker({
  tab,
  onTabChange,
  policies,
  users,
  asGate,
  asUserId,
  onSelectPolicy,
  onSelectUser,
}: {
  readonly tab: AsTab;
  readonly onTabChange: (tab: AsTab) => void;
  readonly policies: readonly QueryGatePolicyChoice[];
  readonly users: readonly QueryGateUserChoice[];
  readonly asGate: string | null;
  readonly asUserId: string | null;
  readonly onSelectPolicy: (policy: QueryGatePolicyChoice) => void;
  readonly onSelectUser: (user: QueryGateUserChoice) => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const selected =
    tab === "user"
      ? users.find((user) => user.id === asUserId)
      : policies.find((policy) => policy.id === asGate);
  const visibleUsers = filterQueryGateAsChoices(users, query, (user) => [user.gate]);
  const visiblePolicies = filterQueryGateAsChoices(policies, query);
  const rows = tab === "user" ? visibleUsers : visiblePolicies;
  const searching = query.trim() !== "";

  return (
    <div className="flex flex-col gap-2" data-slot="store-query-gate-as">
      <div
        className="inline-flex w-fit rounded-full bg-muted/70 p-0.5"
        role="tablist"
        aria-label="As a user or policy"
      >
        <AsTabButton
          active={tab === "user"}
          disabled={users.length === 0}
          onClick={() => onTabChange("user")}
        >
          User
        </AsTabButton>
        <AsTabButton
          active={tab === "policy"}
          disabled={policies.length === 0}
          onClick={() => onTabChange("policy")}
        >
          Policy
        </AsTabButton>
      </div>
      <label className="relative block">
        <HugeiconsIcon
          icon={Search01Icon}
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder={tab === "user" ? "Search users" : "Search policies"}
          aria-label={tab === "user" ? "Search users" : "Search policies"}
          className="h-8 pl-7 font-mono text-[12px]"
        />
      </label>
      <ul
        role="listbox"
        aria-label={tab === "user" ? "Users" : "Policy gates"}
        className="max-h-40 overflow-y-auto"
      >
        {rows.length === 0 ? (
          <li className="px-1 py-2 text-[10px] text-muted-foreground">
            {searching
              ? "No matches."
              : tab === "user"
                ? "No identities map to a policy Gate."
                : "No policy Gates declared."}
          </li>
        ) : tab === "user" ? (
          visibleUsers.map((user) => (
            <AsRow
              key={user.id}
              icon={UserIcon}
              label={user.label}
              detail={`${user.detail} · ${user.gate}`}
              selected={user.id === asUserId}
              onSelect={() => onSelectUser(user)}
            />
          ))
        ) : (
          visiblePolicies.map((policy) => (
            <AsRow
              key={policy.id}
              icon={SecurityCheckIcon}
              label={policy.label}
              detail={policy.detail}
              selected={policy.id === asGate}
              onSelect={() => onSelectPolicy(policy)}
            />
          ))
        )}
      </ul>
      {selected ? (
        <p className="px-0.5 text-[10px] leading-relaxed text-muted-foreground">
          {tab === "user" && asUserId ? (
            <>
              View as <span className="font-medium text-foreground">{selected.label}</span> via{" "}
              <span className="font-mono">{asGate}</span>. Sets{" "}
              <span className="font-mono">oke.gate</span> so policies can use{" "}
              <span className="font-mono">current_setting('oke.gate', true)</span>.
            </>
          ) : (
            <>
              {selected.detail} Sets <span className="font-mono">oke.gate</span> so policies can use{" "}
              <span className="font-mono">current_setting('oke.gate', true)</span>.
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}

function AsTabButton({
  active,
  disabled,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      {children}
    </button>
  );
}

function AsRow({
  icon,
  label,
  detail,
  selected,
  onSelect,
}: {
  readonly icon: typeof UserIcon;
  readonly label: string;
  readonly detail: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        className={cn(
          "flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left",
          selected ? "bg-muted" : "hover:bg-muted/50",
        )}
      >
        <HugeiconsIcon icon={icon} className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium">{label}</span>
          <span className="block truncate text-[10px] text-muted-foreground">{detail}</span>
        </span>
        {selected ? <HugeiconsIcon icon={Tick02Icon} className="mt-0.5 size-3.5 shrink-0" /> : null}
      </button>
    </li>
  );
}
