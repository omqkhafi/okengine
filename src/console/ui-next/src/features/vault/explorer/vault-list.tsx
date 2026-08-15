/**
 * Vault list — secrets / config bands with posture marks.
 */

import {
  Alert02Icon,
  ArrowDown01Icon,
  Clock01Icon,
  SourceCodeIcon,
  UnavailableIcon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState, type JSX } from "react";
import {
  EXPLORER_BAND_CLASS,
  EXPLORER_BAND_HEADER_CLASS,
  EXPLORER_BAND_LABEL_CLASS,
  EXPLORER_COUNT_CLASS,
  EXPLORER_LIST_EMPTY_CLASS,
  EXPLORER_RAIL_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_ROW_SELECTED_CLASS,
  EXPLORER_WELL_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { ELEMENT_ICONS, type ElementHugeIcon } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils.ts";
import {
  contractPosture,
  isRotateCadence,
  postureHint,
  postureLabel,
  type VaultPosture,
} from "../lib/posture.ts";
import { VAULT_ACCENT } from "../lib/theme.ts";
import type { VaultKindGroup, VaultRecord } from "../lib/types.ts";

/** Props for {@link VaultList}. */
export interface VaultListProps {
  readonly groups: readonly VaultKindGroup[];
  readonly selectedName: string | null;
  readonly loading?: boolean;
  readonly matchCount: number;
  readonly totalCount: number;
  readonly now: number;
  readonly onSelect: (name: string) => void;
}

const KIND_WELL: Record<VaultKindGroup["kind"], string> = {
  secret: "border-indigo-500/40 bg-indigo-500/12 text-indigo-600 dark:text-indigo-300",
  config: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

const KIND_ICON: Record<VaultKindGroup["kind"], ElementHugeIcon> = {
  secret: ELEMENT_ICONS.vault.icon,
  config: SourceCodeIcon,
};

const KIND_HINT: Record<VaultKindGroup["kind"], string> = {
  secret: "fingerprints only",
  config: "vault.config · shown in clear",
};

const POSTURE_WELL: Record<VaultPosture["primary"], string> = {
  blast: "border-destructive/40 bg-destructive/10 text-destructive",
  unset: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  overdue: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  shared: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  dormant: "border-zinc-500/35 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400",
  healthy: KIND_WELL.secret,
  config: KIND_WELL.config,
};

const POSTURE_ICON: Record<VaultPosture["primary"], ElementHugeIcon> = {
  blast: Alert02Icon,
  unset: UnavailableIcon,
  overdue: Clock01Icon,
  shared: UserMultipleIcon,
  dormant: UnavailableIcon,
  healthy: ELEMENT_ICONS.vault.icon,
  config: SourceCodeIcon,
};

const POSTURE_MARK: Record<VaultPosture["primary"], string> = {
  blast: "border-destructive/30 text-destructive",
  unset: "border-amber-500/30 text-amber-800 dark:text-amber-400",
  overdue: "border-amber-500/30 text-amber-800 dark:text-amber-400",
  shared: "border-amber-500/30 text-amber-800 dark:text-amber-400",
  dormant: "border-border/60 text-muted-foreground",
  healthy: "border-indigo-500/30 text-indigo-600 dark:text-indigo-300",
  config: "border-emerald-500/30 text-emerald-700 dark:text-emerald-400",
};

/**
 * Grouped contract list with posture marks and reader counts.
 *
 * @param props - Groups + selection
 */
export function VaultList({
  groups,
  selectedName,
  loading = false,
  matchCount,
  totalCount,
  now,
  onSelect,
}: VaultListProps): JSX.Element {
  const [openByKind, setOpenByKind] = useState<Readonly<Record<string, boolean>>>({
    secret: true,
    config: true,
  });

  useEffect(() => {
    const group = groups.find((g) => g.secrets.some((row) => row.name === selectedName));
    if (!group) return;
    setOpenByKind((prev) => (prev[group.kind] === false ? { ...prev, [group.kind]: true } : prev));
  }, [groups, selectedName]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-slot="vault-list">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && groups.length === 0 ? (
          <p className={EXPLORER_LIST_EMPTY_CLASS}>Loading…</p>
        ) : null}
        {!loading && groups.length === 0 ? (
          <p className={EXPLORER_LIST_EMPTY_CLASS}>
            No contracts match. Try <span className="font-mono">is:unset</span> or clear the search.
          </p>
        ) : null}
        {groups.map((group) => {
          const open = openByKind[group.kind] !== false;
          return (
            <section
              key={group.kind}
              aria-label={group.label}
              className={EXPLORER_BAND_CLASS}
              data-slot="vault-kind-band"
              data-kind={group.kind}
            >
              <Collapsible
                open={open}
                onOpenChange={(next) => setOpenByKind((prev) => ({ ...prev, [group.kind]: next }))}
              >
                <CollapsibleTrigger
                  nativeButton={false}
                  className={EXPLORER_BAND_HEADER_CLASS}
                  data-slot="vault-kind-band-toggle"
                  render={(props) => (
                    <div {...props}>
                      <span
                        className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors group-hover/band:bg-muted/80 group-hover/band:text-foreground"
                        aria-hidden
                      >
                        <HugeiconsIcon
                          icon={ArrowDown01Icon}
                          className={cn("size-3 transition-transform", !open && "-rotate-90")}
                        />
                      </span>
                      <span className={cn(EXPLORER_WELL_CLASS, KIND_WELL[group.kind])} aria-hidden>
                        <HugeiconsIcon icon={KIND_ICON[group.kind]} className="size-3" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={EXPLORER_BAND_LABEL_CLASS}>{group.label}</span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {KIND_HINT[group.kind]}
                        </span>
                      </span>
                      <span className={EXPLORER_COUNT_CLASS}>{group.secrets.length}</span>
                    </div>
                  )}
                />
                <CollapsibleContent>
                  <ul className="flex flex-col gap-0.5 p-1">
                    {group.secrets.map((row) => (
                      <VaultListItem
                        key={row.name}
                        row={row}
                        selected={row.name === selectedName}
                        now={now}
                        onSelect={onSelect}
                      />
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            </section>
          );
        })}
      </div>
      {groups.length > 0 ? (
        <p className="sr-only">
          {matchCount === totalCount
            ? `${totalCount} contracts`
            : `${matchCount} of ${totalCount} contracts`}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One selectable vault contract.
 *
 * @param props - Row + selection
 */
function VaultListItem({
  row,
  selected,
  now,
  onSelect,
}: {
  readonly row: VaultRecord;
  readonly selected: boolean;
  readonly now: number;
  readonly onSelect: (name: string) => void;
}): JSX.Element {
  const label = row.description ?? row.name;
  const posture = contractPosture(row, now);
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(row.name)}
        className={cn(
          EXPLORER_ROW_CLASS,
          "flex-col items-start gap-0.5",
          selected && EXPLORER_ROW_SELECTED_CLASS,
        )}
      >
        <span
          aria-hidden
          className={cn(EXPLORER_RAIL_CLASS, selected && "bg-[var(--vault-accent)]")}
          style={{ ["--vault-accent" as string]: VAULT_ACCENT }}
        />
        <span className="flex w-full items-center gap-2">
          <span className={cn(EXPLORER_WELL_CLASS, POSTURE_WELL[posture.primary])} aria-hidden>
            <HugeiconsIcon icon={POSTURE_ICON[posture.primary]} className="size-3" />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{label}</span>
          {row.origin === "console" ? (
            <span className="shrink-0 rounded-md border border-border/60 px-1.5 py-px text-[10px] text-muted-foreground">
              console
            </span>
          ) : null}
          {row.kind === "secret" && !isRotateCadence(row.rotate) ? (
            <span className="shrink-0 rounded-md border border-border/60 px-1.5 py-px text-[10px] text-muted-foreground">
              no rotate
            </span>
          ) : null}
          <PostureMark posture={posture} rotate={row.rotate} />
        </span>
        <span className="flex w-full items-center gap-1.5 pl-7">
          <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
            {row.kind === "config" ? (row.cleartext ?? "unset") : row.name}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {row.readers.length === 0
              ? "no readers"
              : `${row.readers.length} reader${row.readers.length === 1 ? "" : "s"}`}
          </span>
        </span>
      </button>
    </li>
  );
}

function PostureMark({
  posture,
  rotate,
}: {
  readonly posture: VaultPosture;
  readonly rotate?: string;
}): JSX.Element {
  return (
    <ToolbarTip label={postureHint(posture.primary, rotate)}>
      <span
        role="status"
        className={cn(
          "shrink-0 rounded-md border px-1.5 py-px text-[10px]",
          POSTURE_MARK[posture.primary],
        )}
      >
        {postureLabel(posture.primary)}
      </span>
    </ToolbarTip>
  );
}
