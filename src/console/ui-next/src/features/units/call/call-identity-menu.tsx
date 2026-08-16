/**
 * Call API invoke-as picker — same Operator / Public / As cards as Store Gate.
 */

import { useMemo, useState, type JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Manifest } from "../../../../../../manifest/types.ts";
import type { FlowIdentity } from "@/client.ts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils.ts";
import { useGates } from "@/features/store/data/use-gates.ts";
import {
  queryGateMode,
  queryGatePolicyChoices,
  queryGateUserChoices,
  type QueryGateMode,
} from "@/features/store/lib/query-gate.ts";
import { mergeRlsGateCatalog, rlsGateCatalog } from "@/features/store/lib/rls-gate-catalog.ts";
import {
  GateAsPicker,
  GateModeCard,
  GateModeDetail,
  GateModeStrip,
  GatePickerHeading,
  type GateAsTab,
} from "@/features/store/query/query-gate-parts.tsx";

/** Current Call API invoke-as pick. */
export type CallInvokeAs = {
  readonly asGate: string | null;
  readonly asUserId: string | null;
};

/** Props for {@link CallIdentityMenu}. */
export interface CallIdentityMenuProps {
  readonly manifest: Manifest | null;
  readonly identities: readonly FlowIdentity[];
  readonly value: CallInvokeAs;
  readonly onChange: (next: CallInvokeAs) => void;
}

/**
 * Toolbar label for the current invoke-as pick.
 *
 * @param value - Gate + optional user
 * @param identities - Seeded identities
 */
export function callInvokeAsToolbarLabel(
  value: CallInvokeAs,
  identities: readonly FlowIdentity[],
): string {
  const mode = queryGateMode(value.asGate);
  if (mode === "operator") return "Operator";
  if (mode === "public") return "Public";
  if (value.asUserId) {
    const user = identities.find((row) => row.id === value.asUserId);
    return user?.name ?? value.asUserId;
  }
  return value.asGate ? `As · ${value.asGate}` : "As";
}

/**
 * Whether Call API can submit for this pick.
 *
 * @param value - Gate + optional user
 */
export function callInvokeAsReady(value: CallInvokeAs): boolean {
  const mode = queryGateMode(value.asGate);
  if (mode === "operator" || mode === "public") return true;
  return Boolean(value.asUserId || value.asGate);
}

/**
 * Toolbar control: invoke the flow as Operator, public, a user, or a Gate.
 *
 * @param props - Manifest + identities + current pick
 */
export function CallIdentityMenu({
  manifest,
  identities,
  value,
  onChange,
}: CallIdentityMenuProps): JSX.Element {
  const gatesQuery = useGates(true);
  const catalog = useMemo(
    () => mergeRlsGateCatalog(rlsGateCatalog(manifest), gatesQuery.data ?? null),
    [manifest, gatesQuery.data],
  );
  const policies = useMemo(() => queryGatePolicyChoices(catalog), [catalog]);
  const users = useMemo(() => queryGateUserChoices(identities, catalog), [identities, catalog]);
  const publicDetail =
    catalog.gates.find((gate) => gate.kind === "public")?.description ??
    "Intentionally unauthenticated.";
  const mode = queryGateMode(value.asGate);
  const active = value.asGate !== null;
  const [asTab, setAsTab] = useState<GateAsTab>(value.asUserId ? "user" : "policy");
  const selectedPolicy = policies.find((policy) => policy.id === value.asGate) ?? null;
  const selectedUser =
    users.find((user) => user.id === value.asUserId && user.gate === value.asGate) ?? null;
  const asEnabled = policies.length > 0 || users.length > 0;

  const selectMode = (next: QueryGateMode): void => {
    if (next === "operator") {
      onChange({ asGate: null, asUserId: null });
      return;
    }
    if (next === "public") {
      onChange({ asGate: "public", asUserId: null });
      return;
    }
    if (mode === "as") return;
    const fallback = selectedPolicy?.id ?? policies[0]?.id ?? users[0]?.gate ?? null;
    if (fallback === null) return;
    if (users[0] && fallback === users[0].gate && policies.length === 0) {
      setAsTab("user");
      onChange({ asGate: users[0].gate, asUserId: users[0].id });
      return;
    }
    setAsTab("policy");
    onChange({ asGate: fallback, asUserId: null });
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
              "h-8 max-w-44 min-w-0 rounded-none px-2 text-[11px]",
              active && "text-sky-800 dark:text-sky-300",
            )}
            aria-label={
              active ? `Invoke as Gate ${value.asGate}` : "Invoke as Operator (bypass gates)"
            }
            data-slot="call-api-identity"
          >
            <HugeiconsIcon
              icon={ELEMENT_ICONS.gate.icon}
              data-icon="inline-start"
              className="size-3.5"
            />
            <span className="truncate">{callInvokeAsToolbarLabel(value, identities)}</span>
          </Button>
        )}
      />
      <DropdownMenuContent align="end" className="w-80 overflow-hidden p-0">
        <GatePickerHeading>Invoke as</GatePickerHeading>
        <GateModeStrip label="Invoke as">
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
            Bypasses the flow&apos;s gate chain.
          </GateModeDetail>
        ) : null}
        {mode === "public" ? (
          <GateModeDetail title="Public">
            {publicDetail} Only <span className="font-mono">gate.public</span> flows succeed.
          </GateModeDetail>
        ) : null}
        {mode === "as" ? (
          <GateAsPicker
            tab={asTab}
            onTabChange={setAsTab}
            policies={policies}
            users={users}
            asGate={value.asGate}
            asUserId={selectedUser?.id ?? null}
            onSelectPolicy={(policy) => {
              setAsTab("policy");
              onChange({ asGate: policy.id, asUserId: null });
            }}
            onSelectUser={(user) => {
              setAsTab("user");
              onChange({ asGate: user.gate, asUserId: user.id });
            }}
            hint={
              selectedUser ? (
                <p className="border-t border-border/60 px-2 py-2 text-[10px] leading-relaxed text-muted-foreground">
                  Calls as <span className="font-medium text-foreground">{selectedUser.label}</span>{" "}
                  via <span className="font-mono">{value.asGate}</span>.
                </p>
              ) : selectedPolicy ? (
                <p className="border-t border-border/60 px-2 py-2 text-[10px] leading-relaxed text-muted-foreground">
                  {selectedPolicy.detail} Sets scopes for{" "}
                  <span className="font-mono">{selectedPolicy.id}</span>.
                </p>
              ) : null
            }
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
