/**
 * Query-console Gate picker — Operator, public, or a selected user / policy.
 */

import { useMemo, useState, type JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Manifest } from "../../../../../../manifest/types.ts";
import { Button } from "@/components/ui/button";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils.ts";
import { useFlowsIdentities } from "@/features/units/data/use-flows-invoke.ts";
import { useGates } from "../data/use-gates.ts";
import {
  queryGateMode,
  queryGatePolicyChoices,
  queryGateToolbarLabel,
  queryGateUserChoices,
  type QueryGateMode,
} from "../lib/query-gate.ts";
import { mergeRlsGateCatalog, rlsGateCatalog } from "../lib/rls-gate-catalog.ts";
import {
  GateAsPicker,
  GateModeCard,
  GateModeDetail,
  GateModeStrip,
  GatePickerHeading,
  type GateAsTab,
} from "./query-gate-parts.tsx";

/** Props for {@link QueryGateMenu}. */
export interface QueryGateMenuProps {
  readonly manifest: Manifest | null;
  readonly asGate: string | null;
  readonly onChange: (asGate: string | null) => void;
}

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
  const [asTab, setAsTab] = useState<GateAsTab>("policy");
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(props) => (
          <Button
            {...props}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-full max-w-44 min-w-0 rounded-none px-2 text-[11px]",
              active && "text-sky-800 dark:text-sky-300",
            )}
            aria-label={active ? `View data as Gate ${asGate}` : "View data as Operator (default)"}
            data-slot="store-query-gate"
          >
            <HugeiconsIcon
              icon={ELEMENT_ICONS.gate.icon}
              data-icon="inline-start"
              className="size-3.5"
            />
            <span className="truncate">{queryGateToolbarLabel(asGate)}</span>
          </Button>
        )}
      />
      <DropdownMenuContent align="start" className="w-80 overflow-hidden p-0">
        <GatePickerHeading>View as</GatePickerHeading>
        <GateModeStrip label="View data as">
          <GateModeCard
            mode="operator"
            title="Operator"
            caption="Bypass"
            selected={mode === "operator"}
            onSelect={() => selectMode("operator")}
          />
          <GateModeCard
            mode="public"
            title="Public"
            caption="Anonymous"
            selected={mode === "public"}
            onSelect={() => selectMode("public")}
          />
          <GateModeCard
            mode="as"
            title="As"
            caption={selectedUser ? selectedUser.label : (selectedPolicy?.label ?? "User / policy")}
            selected={mode === "as"}
            disabled={!asEnabled}
            onSelect={() => selectMode("as")}
          />
        </GateModeStrip>
        {mode === "operator" ? (
          <GateModeDetail title="Operator" badge="Default">
            Bypasses RLS. No <span className="font-mono">oke.gate</span> is set.
          </GateModeDetail>
        ) : null}
        {mode === "public" ? (
          <GateModeDetail title="Public">
            {publicDetail} Sets <span className="font-mono">oke.gate</span> to{" "}
            <span className="font-mono">public</span>.
          </GateModeDetail>
        ) : null}
        {mode === "as" ? (
          <GateAsPicker
            tab={asTab}
            onTabChange={setAsTab}
            policies={policies}
            users={users}
            asGate={asGate}
            asUserId={selectedUser?.id ?? null}
            onSelectPolicy={(policy) => {
              setAsUserId(null);
              setAsTab("policy");
              onChange(policy.id);
            }}
            onSelectUser={(user) => {
              setAsUserId(user.id);
              setAsTab("user");
              onChange(user.gate);
            }}
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
