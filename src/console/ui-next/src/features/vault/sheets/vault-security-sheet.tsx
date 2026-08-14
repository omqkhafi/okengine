/**
 * Advanced vault security — backend facts, verify, rotate-master, CLI.
 */

import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState, type JSX } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils.ts";
import type { VaultBackendCard } from "../lib/backend.ts";
import type { RewrapProgressLine } from "../lib/progress.ts";
import { VAULT_ACCENT } from "../lib/theme.ts";

/** CLI commands that stay off the HTTP surface. */
export const VAULT_CLI_COMMANDS: readonly {
  readonly id: string;
  readonly cmd: string;
  readonly label: string;
}[] = [
  { id: "status", cmd: "oke vault status", label: "Backend seal + KEK" },
  { id: "audit", cmd: "oke vault audit", label: "Hash-chained audit log" },
  { id: "verify", cmd: "oke vault audit verify", label: "Verify the chain on disk" },
  { id: "backup", cmd: "oke vault backup", label: "Encrypted backup" },
  { id: "restore", cmd: "oke vault restore", label: "Restore from backup" },
];

/** Props for {@link VaultSecuritySheet}. */
export interface VaultSecuritySheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly card: VaultBackendCard | null;
  readonly env: string;
  readonly progress: RewrapProgressLine | null;
  readonly verifyPending?: boolean;
  readonly verifyNote: string | null;
  readonly onVerify: () => void;
  readonly onRotateMaster: () => void;
  readonly onExport: () => void;
}

/**
 * Operator security panel — no master key in the HTTP body.
 *
 * @param props - Backend + actions
 */
export function VaultSecuritySheet({
  open,
  onOpenChange,
  card,
  env,
  progress,
  verifyPending = false,
  verifyNote,
  onVerify,
  onRotateMaster,
  onExport,
}: VaultSecuritySheetProps): JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="sm:max-w-md"
        data-slot="vault-security-sheet"
      >
        <SheetHeader>
          <SheetTitle>Vault security</SheetTitle>
          <SheetDescription>
            Fingerprints and backend status only. Backup, restore, and unseal stay on the CLI.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <section className="flex flex-col gap-2 border-b border-border/50 px-4 py-3">
            <h3 className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Backend
            </h3>
            <p className="text-[12px] font-medium">{card?.title ?? "Unresolved"}</p>
            <p className="text-[11px] text-muted-foreground">
              {card?.description ?? "The server could not resolve a vault backend."}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground">env {env}</span>
              {card?.badges.map((badge) => (
                <Badge
                  key={badge.id}
                  variant="outline"
                  role={badge.tone === "warn" ? "alert" : "status"}
                  className={cn(
                    "h-5 rounded-md text-[10px]",
                    badge.tone === "warn" &&
                      "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-400",
                  )}
                >
                  {badge.label}
                </Badge>
              ))}
            </div>
            {card?.facts.length ? (
              <dl className="flex flex-col gap-1">
                {card.facts.map((fact) => (
                  <div key={fact.label} className="flex justify-between gap-3">
                    <dt className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
                      {fact.label}
                    </dt>
                    <dd className="font-mono text-[11px]">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {card?.hint ? (
              <p className="text-[11px] text-muted-foreground" role="status">
                {card.hint}
              </p>
            ) : null}
            {progress ? (
              <p className="font-mono text-[11px]" style={{ color: VAULT_ACCENT }} role="status">
                {progress.headline}
                <span className="ml-2 font-sans text-muted-foreground">{progress.detail}</span>
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-2 border-b border-border/50 px-4 py-3">
            <h3 className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Actions
            </h3>
            <div className="flex flex-col gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={verifyPending}
                onClick={onVerify}
              >
                Verify audit chain
              </Button>
              {verifyNote ? (
                <p className="text-[11px] text-muted-foreground" role="status">
                  {verifyNote}
                </p>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={onRotateMaster}>
                Rotate master key
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onExport}>
                Export fingerprints
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Master rotation rewraps DEKs in batches. Both keys stay live until remaining is 0. The
              new key is shown once.
            </p>
          </section>

          <section className="flex flex-col gap-2 px-4 py-3">
            <h3 className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              CLI
            </h3>
            <p className="text-[11px] text-muted-foreground">
              The Console never accepts a master key in the HTTP body.
            </p>
            <ul className="flex flex-col gap-1">
              {VAULT_CLI_COMMANDS.map((row) => (
                <CliRow key={row.id} cmd={row.cmd} label={row.label} />
              ))}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CliRow({ cmd, label }: { readonly cmd: string; readonly label: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[11px]">{cmd}</p>
        <p className="text-[10px] text-muted-foreground">{label}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Copy ${cmd}`}
        onClick={() => {
          void navigator.clipboard?.writeText(cmd);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }}
      >
        <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} />
      </Button>
    </li>
  );
}
