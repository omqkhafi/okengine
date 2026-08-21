/**
 * Create an Access API key — issuer + attenuated scopes, secret once.
 */

import { CrownIcon, UserIcon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useState, type JSX } from "react";
import type { AccessCreateKeyInput, AccessUserRow } from "@/client.ts";
import {
  EXPLORER_RAIL_ACTIVE_CLASS,
  EXPLORER_RAIL_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_ROW_SELECTED_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { Input } from "@/components/ui/input";
import {
  SHEET_CONTROL,
  SheetChoice,
  SheetChoiceRow,
  SheetError,
  SheetFooterButton,
} from "@/components/ui/sheet-form.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils.ts";
import {
  accessExpiresAt,
  parseAccessDurationMs,
  DEFAULT_ACCESS_RATE_UNIT,
  parseAccessRateParts,
  type AccessExpiryChoice,
  type AccessRateUnit,
} from "../lib/format-when.ts";
import { AccessAllowFields } from "./access-allow-fields.tsx";
import { AccessExpiryFields } from "./access-expiry-fields.tsx";
import { AccessScopeField } from "./access-scope-field.tsx";
import { AccessSheetSearch } from "./access-sheet-search.tsx";

/** Props for {@link AccessCreateSheet}. */
export interface AccessCreateSheetProps {
  readonly open: boolean;
  readonly users: readonly AccessUserRow[];
  readonly userScopes: readonly string[];
  readonly operatorScopes: readonly string[];
  readonly pending: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (input: AccessCreateKeyInput) => void;
}

/**
 * Create sheet — plane, issuer, name, expiry, allow, rate, scopes.
 *
 * @param props - Open + catalog + submit
 */
export function AccessCreateSheet({
  open,
  users,
  userScopes,
  operatorScopes,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: AccessCreateSheetProps): JSX.Element {
  const [plane, setPlane] = useState<"user" | "operator">("user");
  const [name, setName] = useState("");
  const [creatorUserId, setCreatorUserId] = useState("");
  const [scopes, setScopes] = useState<readonly string[]>([]);
  const [expires, setExpires] = useState<AccessExpiryChoice>("never");
  const [customExpires, setCustomExpires] = useState("");
  const [allowEntries, setAllowEntries] = useState<readonly string[]>([]);
  const [rateMax, setRateMax] = useState("");
  const [rateCount, setRateCount] = useState("");
  const [rateUnit, setRateUnit] = useState<AccessRateUnit>(DEFAULT_ACCESS_RATE_UNIT);
  const [issuerQuery, setIssuerQuery] = useState("");

  const issuer = users.find((user) => user.id === creatorUserId) ?? null;
  const visibleUsers = useMemo(() => {
    const q = issuerQuery.trim().toLowerCase();
    const matched =
      q.length === 0
        ? users
        : users.filter(
            (user) =>
              user.name.toLowerCase().includes(q) ||
              user.id.toLowerCase().includes(q) ||
              user.email.toLowerCase().includes(q),
          );
    if (issuer && !matched.some((user) => user.id === issuer.id)) {
      return [issuer, ...matched];
    }
    return matched;
  }, [users, issuerQuery, issuer]);
  const grantable = useMemo(() => {
    if (plane === "operator") return operatorScopes;
    if (issuer == null) return [];
    if (issuer.scopes.length > 0) return issuer.scopes;
    return userScopes;
  }, [plane, userScopes, operatorScopes, issuer]);

  useEffect(() => {
    if (!open) {
      setPlane("user");
      setName("");
      setCreatorUserId("");
      setScopes([]);
      setExpires("never");
      setCustomExpires("");
      setAllowEntries([]);
      setRateMax("");
      setRateCount("");
      setRateUnit(DEFAULT_ACCESS_RATE_UNIT);
      setIssuerQuery("");
    }
  }, [open]);

  useEffect(() => {
    setScopes((prev) => {
      const kept = prev.filter((scope) => grantable.includes(scope));
      if (kept.length > 0) return kept;
      const first = grantable[0];
      return first ? [first] : [];
    });
  }, [grantable]);

  const customMs = parseAccessDurationMs(customExpires);
  const parsedRate = parseAccessRateParts(rateMax, rateCount, rateUnit);
  const ready =
    name.trim().length > 0 &&
    scopes.length > 0 &&
    !pending &&
    parsedRate !== undefined &&
    (plane === "operator" || creatorUserId.length > 0) &&
    (expires !== "custom" || customMs > 0);

  return (
    <Sheet open={open} modal={false} disablePointerDismissal onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="gap-0 p-0 data-[side=right]:sm:max-w-md"
        data-slot="access-create-sheet"
      >
        <SheetHeader className="gap-1 border-b border-border/50">
          <SheetTitle className="text-sm">Create API key</SheetTitle>
          <SheetDescription className="text-[11px]">
            {plane === "user"
              ? "User-plane keys require an issuer. The key cannot exceed that user's grants."
              : "Operator keys inherit the actor ceiling. Absence is impossible — only grantable scopes appear."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div
            className="flex items-stretch border-b border-border/50"
            data-slot="access-name-field"
          >
            <p className="flex h-8 w-[5.5rem] shrink-0 items-center px-4 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Name
            </p>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="CI deploy"
              autoComplete="off"
              aria-label="Key name"
              flat
              className={cn(SHEET_CONTROL, "min-w-0 flex-1")}
            />
          </div>

          <SheetChoiceRow label="Plane">
            <SheetChoice
              active={plane === "user"}
              icon={UserIcon}
              onClick={() => {
                setPlane("user");
              }}
            >
              user
            </SheetChoice>
            <SheetChoice
              active={plane === "operator"}
              icon={CrownIcon}
              onClick={() => {
                setPlane("operator");
                setCreatorUserId("");
                setIssuerQuery("");
              }}
            >
              operator
            </SheetChoice>
          </SheetChoiceRow>

          <AccessExpiryFields
            expires={expires}
            customExpires={customExpires}
            onExpires={setExpires}
            onCustomExpires={setCustomExpires}
          />
          <AccessAllowFields
            entries={allowEntries}
            rateMax={rateMax}
            rateCount={rateCount}
            rateUnit={rateUnit}
            onEntries={setAllowEntries}
            onRateMax={setRateMax}
            onRateCount={setRateCount}
            onRateUnit={setRateUnit}
          />

          {plane === "user" ? (
            <div className="border-b border-border/50" data-slot="access-issuer-field">
              <div className="flex items-stretch">
                <p className="flex h-8 w-[5.5rem] shrink-0 items-center px-4 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Issuer
                </p>
                {users.length > 0 ? (
                  <AccessSheetSearch
                    value={issuerQuery}
                    placeholder="Search users"
                    label="Search users"
                    onChange={setIssuerQuery}
                  />
                ) : null}
              </div>
              {users.length === 0 ? (
                <p className="border-t border-border/50 px-4 py-3 text-[11px] text-muted-foreground">
                  No users on this plane.
                </p>
              ) : visibleUsers.length === 0 ? (
                <p className="border-t border-border/50 px-4 py-3 text-[11px] text-muted-foreground">
                  No users match.
                </p>
              ) : (
                <div className="max-h-56 overflow-y-auto">
                  {visibleUsers.map((user) => {
                    const selected = user.id === creatorUserId;
                    return (
                      <button
                        key={user.id}
                        type="button"
                        data-slot="access-creator-user"
                        aria-pressed={selected}
                        className={cn(EXPLORER_ROW_CLASS, selected && EXPLORER_ROW_SELECTED_CLASS)}
                        onClick={() => setCreatorUserId(user.id)}
                      >
                        <span
                          className={cn(
                            EXPLORER_RAIL_CLASS,
                            selected && EXPLORER_RAIL_ACTIVE_CLASS,
                          )}
                        />
                        <span className="min-w-0 truncate">{user.name}</span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                          {user.id}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          <AccessScopeField
            scopes={grantable}
            selected={scopes}
            empty={
              plane === "user" && creatorUserId.length === 0
                ? "Select an issuer to see grantable scopes."
                : plane === "user"
                  ? "This user has no grants."
                  : "No grantable scopes on this plane."
            }
            onChange={setScopes}
          />

          {error ? <SheetError slot="access-create-error">{error}</SheetError> : null}
        </div>

        <SheetFooter>
          <SheetFooterButton split onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </SheetFooterButton>
          <SheetFooterButton
            variant="default"
            disabled={!ready}
            data-slot="access-create-submit"
            onClick={() => {
              if (parsedRate === undefined) return;
              const expiresAt = accessExpiresAt(expires, Date.now(), customExpires);
              onSubmit({
                plane,
                name: name.trim(),
                scopes,
                ...(plane === "user" ? { creatorUserId } : {}),
                ...(expiresAt != null ? { expiresAt } : {}),
                ...(parsedRate != null ? { rateLimit: parsedRate } : {}),
                ...(allowEntries.length > 0 ? { ipAllowlist: allowEntries } : {}),
              });
            }}
          >
            {pending ? "Creating…" : "Create"}
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
