/**
 * Edit an Access key — name, expiry, allowlist, rate, re-attenuated scopes.
 */

import { CrownIcon, UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState, type JSX } from "react";
import type { AccessKeyRow, AccessOperatorRow, AccessUserRow } from "@/client.ts";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils.ts";
import { SHEET_CONTROL, SheetError, SheetFooterButton } from "@/components/ui/sheet-form.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  accessExpiresAt,
  accessExpiryFromAt,
  parseAccessDurationMs,
  parseAccessRateParts,
  splitAccessRatePer,
  type AccessExpiryChoice,
  type AccessRateUnit,
} from "../lib/format-when.ts";
import { AccessAllowFields } from "./access-allow-fields.tsx";
import { AccessExpiryFields } from "./access-expiry-fields.tsx";
import { AccessScopeField } from "./access-scope-field.tsx";

/** Patch from {@link AccessEditSheet}. */
export interface AccessEditKeyInput {
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresAt: number | null;
  readonly rateLimit: { max: number; per: string } | null;
  readonly ipAllowlist: readonly string[];
}

/** Props for {@link AccessEditSheet}. */
export interface AccessEditSheetProps {
  readonly open: boolean;
  readonly keyRow: AccessKeyRow;
  readonly users: readonly AccessUserRow[];
  readonly operators: readonly AccessOperatorRow[];
  readonly operatorScopes: readonly string[];
  readonly pending: boolean;
  readonly error: string | null;
  readonly now?: number;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (input: AccessEditKeyInput) => void;
}

/**
 * Edit sheet — tighten metadata against the stored issuer ceiling.
 *
 * @param props - Open + key + submit
 */
export function AccessEditSheet({
  open,
  keyRow,
  users,
  operators,
  operatorScopes,
  pending,
  error,
  now = Date.now(),
  onOpenChange,
  onSubmit,
}: AccessEditSheetProps): JSX.Element {
  const seeded = accessExpiryFromAt(keyRow.expiresAt, now);
  const [name, setName] = useState(keyRow.name);
  const [scopes, setScopes] = useState<readonly string[]>(keyRow.scopes);
  const [expires, setExpires] = useState<AccessExpiryChoice>(seeded.choice);
  const [customExpires, setCustomExpires] = useState(seeded.custom);
  const [allowEntries, setAllowEntries] = useState<readonly string[]>(keyRow.ipAllowlist);
  const seededRate = splitAccessRatePer(keyRow.rateLimit?.per ?? "");
  const [rateMax, setRateMax] = useState(keyRow.rateLimit ? String(keyRow.rateLimit.max) : "");
  const [rateCount, setRateCount] = useState(seededRate.count);
  const [rateUnit, setRateUnit] = useState<AccessRateUnit>(seededRate.unit);

  useEffect(() => {
    if (!open) return;
    const next = accessExpiryFromAt(keyRow.expiresAt, now);
    setName(keyRow.name);
    setScopes(keyRow.scopes);
    setExpires(next.choice);
    setCustomExpires(next.custom);
    setAllowEntries(keyRow.ipAllowlist);
    const nextRate = splitAccessRatePer(keyRow.rateLimit?.per ?? "");
    setRateMax(keyRow.rateLimit ? String(keyRow.rateLimit.max) : "");
    setRateCount(nextRate.count);
    setRateUnit(nextRate.unit);
    // Seed once per open / key — list refetch must not wipe in-progress edits.
  }, [open, keyRow.id]);

  const creatorId = keyRow.creatorId ?? "";
  const issuer = useMemo(() => {
    if (creatorId.length === 0) return null;
    return (
      users.find((row) => row.id === creatorId) ??
      operators.find((row) => row.id === creatorId) ??
      null
    );
  }, [creatorId, operators, users]);
  const issuerCaption = issuer
    ? issuer.name.trim() || issuer.email.trim() || issuer.id
    : creatorId || "Unknown";
  const grantable = useMemo(() => {
    const stored = keyRow.creatorScopes ?? [];
    if (stored.length > 0) return stored;
    if (keyRow.plane === "operator") {
      return issuer && issuer.scopes.length > 0 ? issuer.scopes : operatorScopes;
    }
    return issuer?.scopes ?? [];
  }, [issuer, keyRow.creatorScopes, keyRow.plane, operatorScopes]);
  const catalog = Array.from(new Set([...grantable, ...keyRow.scopes]));
  const customMs = parseAccessDurationMs(customExpires);
  const parsedRate = parseAccessRateParts(rateMax, rateCount, rateUnit);
  const ready =
    name.trim().length > 0 &&
    scopes.length > 0 &&
    !pending &&
    parsedRate !== undefined &&
    (expires !== "custom" || customMs > 0);

  return (
    <Sheet open={open} modal={false} disablePointerDismissal onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="gap-0 p-0 data-[side=right]:sm:max-w-md"
        data-slot="access-edit-sheet"
      >
        <SheetHeader className="gap-1 border-b border-border/50">
          <SheetTitle className="text-sm">Edit key</SheetTitle>
          <SheetDescription className="text-[11px]">
            Change name, expiry, allow, rate, and scopes. Issuer stays frozen.
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
          <div
            className="flex items-stretch border-b border-border/50"
            data-slot="access-issuer-field"
          >
            <p className="flex h-8 w-[5.5rem] shrink-0 items-center px-4 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Issuer
            </p>
            <p
              className="flex min-w-0 flex-1 items-center gap-1.5 px-4 text-[12px] text-muted-foreground"
              aria-label={`Issuer ${issuerCaption}`}
            >
              <HugeiconsIcon
                icon={keyRow.plane === "operator" ? CrownIcon : UserIcon}
                className="size-3 shrink-0"
                aria-hidden
              />
              <span className="min-w-0 truncate text-foreground">{issuerCaption}</span>
            </p>
            {creatorId.length > 0 && creatorId !== issuerCaption ? (
              <span className="flex h-8 shrink-0 items-center pr-4 font-mono text-[10px] text-muted-foreground">
                {creatorId}
              </span>
            ) : null}
          </div>
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
          <AccessScopeField
            scopes={catalog}
            selected={scopes}
            empty={
              keyRow.plane === "user" && issuer == null
                ? "Issuer is gone. Only scopes already on this key remain."
                : keyRow.plane === "user"
                  ? "This issuer has no grants."
                  : "No grantable scopes on this plane."
            }
            onChange={setScopes}
          />
          {error ? <SheetError slot="access-edit-error">{error}</SheetError> : null}
        </div>
        <SheetFooter>
          <SheetFooterButton split onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </SheetFooterButton>
          <SheetFooterButton
            variant="default"
            disabled={!ready}
            data-slot="access-edit-submit"
            onClick={() => {
              if (parsedRate === undefined) return;
              onSubmit({
                name: name.trim(),
                scopes,
                expiresAt: accessExpiresAt(expires, Date.now(), customExpires),
                rateLimit: parsedRate,
                ipAllowlist: allowEntries,
              });
            }}
          >
            {pending ? "Saving…" : "Save"}
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
