/**
 * Store resource workbench — compact identity chrome + browse/edit surface.
 * Schema lives in column headers; writers/readers surface in the command strip.
 */

import { useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Folder01Icon,
  SecurityCheckIcon,
  Timer01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Manifest } from "../../../../../../manifest/types.ts";
import { piiLogicalCount } from "../../../../../../elements/store/classify.ts";
import type { RunRow, StoreListChild, StoreListStore } from "@/client.ts";
import { CopyInlineButton } from "@/components/explorer/copy-inline-button.tsx";
import { DetailHeader } from "@/components/explorer/detail-header.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { durationTone, durationToneChipClass } from "@/features/flows/traces/duration-tone.ts";
import { formatDuration } from "@/features/flows/traces/format-duration.ts";
import { cn } from "@/lib/utils";
import { filesDriverLabel, filesDriverOrigin } from "../lib/files-origin.ts";
import { latestReplicaLagFromRuns } from "../lib/replica-lag.ts";
import { isSqlCatalogChild, storeChildLabel } from "../lib/sql-catalog.ts";
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
  /** Live-merged runs buffer — replica lag follows the newest touching run. */
  readonly runs?: readonly RunRow[];
}

/**
 * Right-pane workbench for a selected store child (effectRef identity).
 *
 * @param props - Selection + Manifest + tenancy + live runs
 */
export function ResourcePanel({
  store,
  child,
  manifest,
  tenancyDeclared,
  tenants,
  tenant,
  onTenantChange,
  runs = [],
}: ResourcePanelProps): JSX.Element {
  const drift = store.migrationDrift;
  const spec = STORE_FACET_SPECS[store.facet];
  const catalog = isSqlCatalogChild(child);
  const piiCount = catalog ? 0 : piiLogicalCount(child.piiColumns);
  const [piiMasked, setPiiMasked] = useState(true);

  useEffect(() => {
    setPiiMasked(true);
  }, [child.effectRef]);

  const effectRefs = useMemo(
    () => new Set(store.children.map((c) => c.effectRef)),
    [store.children],
  );
  const lagMs = latestReplicaLagFromRuns(runs, effectRefs) ?? store.replicaLagMs;
  const lagTone = lagMs != null ? durationTone(lagMs) : null;

  const files = store.facet === "files";
  const showStatus = Boolean(drift || lagMs !== null || store.contentAddressed || piiCount > 0);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-slot="resource-panel">
      <DetailHeader
        dataSlot="resource-header"
        icon={<HugeiconsIcon icon={files ? Folder01Icon : spec.icon} className="size-4" />}
        wellClassName={spec.wellClass}
        title={storeChildLabel(child)}
        badge={
          <>
            <span
              className="shrink-0 font-mono text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase"
              data-slot="facet-badge"
            >
              {files ? "Bucket" : spec.label}
            </span>
            {store.description ? (
              <p className="min-w-0 truncate text-[11px] text-muted-foreground">
                {store.description}
              </p>
            ) : null}
          </>
        }
        subtitle={
          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
            {files ? (
              <>
                <span className="shrink-0 font-mono">{filesDriverLabel(store.driverId)}</span>
                <span aria-hidden className="text-border">
                  ·
                </span>
                <span className="shrink-0">{filesDriverOrigin(store.driverId)}</span>
                <span aria-hidden className="text-border">
                  ·
                </span>
                <code className="min-w-0 truncate font-mono text-foreground/70">
                  {child.effectRef}
                </code>
                <CopyInlineButton value={child.effectRef} label="Copy effect ref" />
              </>
            ) : (
              <>
                <span className="shrink-0 font-mono">{store.ref}</span>
                <span aria-hidden className="text-border">
                  ·
                </span>
                <code className="min-w-0 truncate font-mono text-foreground/70">
                  {child.effectRef}
                </code>
                <CopyInlineButton value={child.effectRef} label="Copy effect ref" />
              </>
            )}
          </div>
        }
        actions={
          showStatus ? (
            <div
              className="flex shrink-0 flex-wrap items-center justify-end gap-1"
              data-slot="resource-status"
            >
              {lagMs !== null && lagTone ? (
                <StatusChip
                  chipClassName={durationToneChipClass(lagTone)}
                  icon={<HugeiconsIcon icon={Timer01Icon} className="size-3" aria-hidden />}
                  title="Replica lag from the newest run that touched this store"
                  data-slot="replica-lag"
                >
                  <span className="font-mono tabular-nums">{formatDuration(lagMs)}</span>
                  <span className="opacity-70">lag</span>
                </StatusChip>
              ) : null}
              {store.contentAddressed ? <StatusChip>content-addressed</StatusChip> : null}
              {piiCount > 0 ? (
                <StatusChip
                  tone={piiMasked ? "sky" : "amber"}
                  icon={<HugeiconsIcon icon={SecurityCheckIcon} className="size-3" aria-hidden />}
                  title={
                    piiMasked
                      ? `PII masked on ${child.piiColumns.join(", ")}. Click to show all cleartext (audited).`
                      : `PII visible on ${child.piiColumns.join(", ")}. Click to remask.`
                  }
                  pressed={piiMasked}
                  ariaLabel={
                    piiMasked
                      ? `PII masking on for ${piiCount} columns. Show all.`
                      : `PII visible for ${piiCount} columns. Hide all.`
                  }
                  data-slot="pii-toggle"
                  onClick={() => setPiiMasked((on) => !on)}
                >
                  {piiCount} PII
                </StatusChip>
              ) : null}
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
            </div>
          ) : undefined
        }
      />

      {store.warnings.length > 0 ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-amber-500/25 bg-amber-500/5 px-3 py-1.5">
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

      <BrowseSection
        store={store}
        child={child}
        manifest={manifest}
        tenancyDeclared={tenancyDeclared}
        tenants={tenants}
        tenant={tenant}
        onTenantChange={onTenantChange}
        piiMasked={piiMasked}
      />
    </div>
  );
}

type ChipTone = "neutral" | "emerald" | "amber" | "sky";

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: "border-border/50 bg-muted/40 text-muted-foreground",
  emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  amber: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  sky: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-400",
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
  readonly pressed?: boolean;
  readonly onClick?: () => void;
  readonly ariaLabel?: string;
  readonly chipClassName?: string;
}

/**
 * Compact status pill for the identity chrome. Pass `onClick` to make it a toggle.
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
  pressed,
  onClick,
  ariaLabel,
  chipClassName,
}: StatusChipProps): JSX.Element {
  const className = cn(
    "inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium whitespace-nowrap",
    chipClassName ?? CHIP_TONES[tone],
    onClick &&
      "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  );

  const chip = onClick ? (
    <button
      type="button"
      className={className}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      data-slot={dataSlot}
      data-drifted={dataDrifted}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  ) : (
    <span className={className} role={role} data-slot={dataSlot} data-drifted={dataDrifted}>
      {icon}
      {children}
    </span>
  );

  if (!title) return chip;

  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) =>
          onClick ? (
            <span {...props} className="inline-flex">
              {chip}
            </span>
          ) : (
            <span {...props}>{chip}</span>
          )
        }
      />
      <TooltipContent side="bottom" className="max-w-xs text-[11px]">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}

function shortFp(fp: string): string {
  return fp.length > 12 ? `${fp.slice(0, 12)}…` : fp;
}
