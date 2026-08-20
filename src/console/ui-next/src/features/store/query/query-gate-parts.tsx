/**
 * Shared Operator / Public / As picker for Store Query Gate and Call API.
 */

import { useState, type JSX, type ReactNode } from "react";
import { Search01Icon, SecurityCheckIcon, Tick02Icon, UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  EXPLORER_RAIL_ACTIVE_CLASS,
  EXPLORER_RAIL_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_ROW_SELECTED_CLASS,
  EXPLORER_STRIP_TOKEN_ACTIVE_CLASS,
  EXPLORER_STRIP_TOKEN_CLASS,
  EXPLORER_STRIP_TOKEN_IDLE_CLASS,
  SECTION_HEAD_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils.ts";
import {
  filterQueryGateAsChoices,
  type QueryGateMode,
  type QueryGatePolicyChoice,
  type QueryGateUserChoice,
} from "../lib/query-gate.ts";
import { QueryGateViz } from "./query-gate-viz.tsx";

/** User vs policy list under the As card. */
export type GateAsTab = "user" | "policy";

/**
 * Uppercase label at the top of the Gate picker.
 *
 * @param props - Heading copy
 */
export function GatePickerHeading({ children }: { readonly children: string }): JSX.Element {
  return (
    <p className={cn(SECTION_HEAD_CLASS, "border-b border-border/60 px-2 py-1.5")}>{children}</p>
  );
}

/**
 * Operator / Public / As strip under {@link GatePickerHeading}.
 *
 * @param props - Radiogroup label + cards
 */
export function GateModeStrip({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex items-stretch border-b border-border/60"
    >
      {children}
    </div>
  );
}

/** Props for {@link GateModeCard}. */
export interface GateModeCardProps {
  readonly mode: QueryGateMode;
  readonly title: string;
  readonly caption: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

/**
 * One Operator / Public / As token — access diagram plus label.
 *
 * @param props - Mode + labels + selection
 */
export function GateModeCard({
  mode,
  title,
  caption,
  selected,
  disabled = false,
  onSelect,
}: GateModeCardProps): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      title={caption}
      onClick={onSelect}
      data-slot="store-query-gate-card"
      data-mode={mode}
      className={cn(
        "flex min-w-0 flex-1 flex-col items-stretch gap-1 px-1.5 pt-2 pb-1.5 text-left transition-colors hover:bg-muted/50 hover:text-foreground",
        selected ? "bg-muted/70 text-foreground" : "text-muted-foreground",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <QueryGateViz mode={mode} active={selected} />
      <span className="flex min-w-0 items-center justify-center gap-1 px-0.5">
        <span className="truncate text-[10px] font-medium">{title}</span>
        {selected && mode === "as" ? (
          <span className="max-w-28 truncate text-[10px] text-muted-foreground">{caption}</span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * One-line hint under Operator or Public.
 *
 * @param props - Heading + copy
 */
export function GateModeDetail({
  title,
  badge,
  children,
}: {
  readonly title: string;
  readonly badge?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div className="px-2 py-2" data-slot="store-query-gate-detail">
      <p className="text-[11px] font-medium text-foreground">
        {title}
        {badge ? <span className="ml-1.5 text-[10px] text-muted-foreground">{badge}</span> : null}
      </p>
      <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

/** Props for {@link GateAsPicker}. */
export interface GateAsPickerProps {
  readonly tab: GateAsTab;
  readonly onTabChange: (tab: GateAsTab) => void;
  readonly policies: readonly QueryGatePolicyChoice[];
  readonly users: readonly QueryGateUserChoice[];
  readonly asGate: string | null;
  readonly asUserId: string | null;
  readonly onSelectPolicy: (policy: QueryGatePolicyChoice) => void;
  readonly onSelectUser: (user: QueryGateUserChoice) => void;
  /** Override the hint under the list (Store RLS vs Call API). */
  readonly hint?: ReactNode;
}

/**
 * User / policy search list under the As card.
 *
 * @param props - Catalog + current pick
 */
export function GateAsPicker({
  tab,
  onTabChange,
  policies,
  users,
  asGate,
  asUserId,
  onSelectPolicy,
  onSelectUser,
  hint,
}: GateAsPickerProps): JSX.Element {
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
    <div className="flex flex-col" data-slot="store-query-gate-as">
      <div
        className="flex h-7 items-stretch border-b border-border/60"
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
      <label className="relative block border-b border-border/60">
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
          flat
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
      {hint !== undefined ? (
        hint
      ) : selected ? (
        <p className="border-t border-border/60 px-2 py-2 text-[10px] leading-relaxed text-muted-foreground">
          {tab === "user" && asUserId ? (
            <>
              View as <span className="font-medium text-foreground">{selected.label}</span> via{" "}
              <span className="font-mono">{asGate}</span>.
            </>
          ) : (
            <>
              {selected.detail} Sets <span className="font-mono">oke.gate()</span> /{" "}
              <span className="font-mono">oke.user()</span> for RLS.
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
        EXPLORER_STRIP_TOKEN_CLASS,
        "font-semibold tracking-[0.08em] uppercase",
        active ? EXPLORER_STRIP_TOKEN_ACTIVE_CLASS : EXPLORER_STRIP_TOKEN_IDLE_CLASS,
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
          EXPLORER_ROW_CLASS,
          "items-start px-2",
          selected && EXPLORER_ROW_SELECTED_CLASS,
        )}
      >
        <span
          aria-hidden
          className={cn(EXPLORER_RAIL_CLASS, selected && EXPLORER_RAIL_ACTIVE_CLASS)}
        />
        <HugeiconsIcon icon={icon} className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{label}</span>
          <span className="block truncate text-[10px] text-muted-foreground">{detail}</span>
        </span>
        {selected ? <HugeiconsIcon icon={Tick02Icon} className="mt-0.5 size-3.5 shrink-0" /> : null}
      </button>
    </li>
  );
}
