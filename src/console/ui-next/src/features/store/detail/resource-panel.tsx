/**
 * Store resource detail — identity header (facet well, copyable effectRef,
 * status chips) + browse. Schema lives in column headers; writers/readers
 * surface in the browse toolbar.
 */

import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  SecurityCheckIcon,
  Tick02Icon,
  Timer01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Manifest } from "../../../../../../manifest/types.ts";
import type { StoreListChild, StoreListStore } from "@/client.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { STORE_FACET_SPECS } from "../lib/store-tree.ts";
import { BrowseSection } from "./browse-section.tsx";

/** Props for {@link ResourcePanel}. */
export interface ResourcePanelProps {
  readonly store: StoreListStore;
  readonly child: StoreListChild;
  readonly manifest: Manifest | null;
  readonly tenancyDeclared: boolean;
  readonly tenants: readonly string[];
  readonly tenant: string | null;
  readonly onTenantChange: (tenant: string | null) => void;
}

/**
 * Right-pane detail for a selected store child (effectRef identity).
 *
 * @param props - Selection + Manifest + tenancy
 */
export function ResourcePanel({
  store,
  child,
  manifest,
  tenancyDeclared,
  tenants,
  tenant,
  onTenantChange,
}: ResourcePanelProps): JSX.Element {
  const drift = store.migrationDrift;
  const spec = STORE_FACET_SPECS[store.facet];
  const piiCount = child.piiColumns.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4" data-slot="resource-panel">
      <header className="flex shrink-0 flex-col gap-2.5" data-slot="resource-header">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg border",
              spec.wellClass,
            )}
            aria-hidden
          >
            <HugeiconsIcon icon={spec.icon} className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground">
                {child.name}
              </h2>
              <span
                className={cn(
                  "inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[9px] font-semibold tracking-[0.14em] uppercase",
                  spec.wellClass,
                )}
                data-slot="facet-badge"
              >
                {spec.label}
              </span>
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="shrink-0 font-mono">{store.ref}</span>
              <span aria-hidden className="text-border">
                ·
              </span>
              <code className="min-w-0 truncate font-mono text-foreground/75">
                {child.effectRef}
              </code>
              <CopyButton value={child.effectRef} />
            </div>
          </div>
        </div>

        {store.description ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{store.description}</p>
        ) : null}

        {drift || store.replicaLagMs !== null || store.contentAddressed || piiCount > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5" data-slot="resource-status">
            {drift ? (
              <StatusChip
                tone={drift.drifted ? "amber" : "emerald"}
                icon={
                  <HugeiconsIcon
                    icon={drift.drifted ? Alert02Icon : CheckmarkCircle02Icon}
                    className="size-3"
                    aria-hidden
                  />
                }
                title={`Migration — declared ${drift.declared} / applied ${drift.applied ?? "(none)"}`}
                role="status"
                data-slot="migration-drift"
                data-drifted={drift.drifted ? "true" : "false"}
              >
                {drift.drifted ? "Drifted" : "In sync"}
                <span className="font-mono opacity-70">{shortFp(drift.declared)}</span>
              </StatusChip>
            ) : null}
            {store.replicaLagMs !== null ? (
              <StatusChip
                icon={<HugeiconsIcon icon={Timer01Icon} className="size-3" aria-hidden />}
                title="Replica lag"
              >
                <span className="font-mono tabular-nums">{store.replicaLagMs}ms</span>
                <span className="opacity-70">lag</span>
              </StatusChip>
            ) : null}
            {store.contentAddressed ? <StatusChip>content-addressed</StatusChip> : null}
            {piiCount > 0 ? (
              <StatusChip
                tone="sky"
                icon={<HugeiconsIcon icon={SecurityCheckIcon} className="size-3" aria-hidden />}
                title={`PII-classified columns: ${child.piiColumns.join(", ")}`}
              >
                {piiCount} PII {piiCount === 1 ? "column" : "columns"}
              </StatusChip>
            ) : null}
          </div>
        ) : null}

        {store.warnings.length > 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <HugeiconsIcon
              icon={Alert02Icon}
              className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden
            />
            <ul
              className="flex flex-col gap-0.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300"
              aria-label="Warnings"
            >
              {store.warnings.map((w) => (
                <li key={`${w.key}:${w.code}`}>
                  <span className="font-mono">{w.key}</span>: {w.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </header>

      <BrowseSection
        store={store}
        child={child}
        manifest={manifest}
        tenancyDeclared={tenancyDeclared}
        tenants={tenants}
        tenant={tenant}
        onTenantChange={onTenantChange}
      />
    </div>
  );
}

type ChipTone = "neutral" | "emerald" | "amber" | "sky";

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: "border-border/60 bg-muted/30 text-muted-foreground",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

/** Props for {@link StatusChip}. */
interface StatusChipProps {
  readonly tone?: ChipTone;
  readonly icon?: ReactNode;
  readonly title?: string;
  readonly children: ReactNode;
  readonly role?: string;
  readonly "data-slot"?: string;
  readonly "data-drifted"?: string;
}

/**
 * Small rounded status pill for the resource header cluster.
 *
 * @param props - Tone + optional leading icon
 */
function StatusChip({
  tone = "neutral",
  icon,
  title,
  children,
  role,
  "data-slot": dataSlot,
  "data-drifted": dataDrifted,
}: StatusChipProps): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[10px] font-medium whitespace-nowrap",
        CHIP_TONES[tone],
      )}
      title={title}
      role={role}
      data-slot={dataSlot}
      data-drifted={dataDrifted}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * Copy-to-clipboard affordance for the effectRef (paste into Flow code).
 *
 * @param props - Value to copy
 */
function CopyButton({ value }: { readonly value: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <button
            {...props}
            type="button"
            aria-label={`Copy ${value}`}
            className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => {
              if (!navigator.clipboard) return;
              navigator.clipboard
                .writeText(value)
                .then(() => {
                  setCopied(true);
                  if (timer.current) clearTimeout(timer.current);
                  timer.current = setTimeout(() => setCopied(false), 1200);
                })
                .catch(() => {});
            }}
          >
            <HugeiconsIcon
              icon={copied ? Tick02Icon : Copy01Icon}
              className={copied ? "size-3 text-emerald-600 dark:text-emerald-400" : "size-3"}
              aria-hidden
            />
          </button>
        )}
      />
      <TooltipContent side="top" className="text-[11px]">
        {copied ? "Copied" : "Copy effect ref"}
      </TooltipContent>
    </Tooltip>
  );
}

function shortFp(fp: string): string {
  return fp.length > 12 ? `${fp.slice(0, 12)}…` : fp;
}
