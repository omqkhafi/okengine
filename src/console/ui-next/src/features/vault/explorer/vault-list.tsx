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
  EXPLORER_CHEVRON_CLASS,
  EXPLORER_COUNT_CLASS,
  EXPLORER_ICON_CLASS,
  EXPLORER_LIST_EMPTY_CLASS,
  EXPLORER_RAIL_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_ROW_SELECTED_CLASS,
  explorerIconInk,
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

const POSTURE_INK: Record<VaultPosture["primary"], string> = {
  blast: "text-destructive",
  unset: "text-amber-800 dark:text-amber-400",
  overdue: "text-amber-800 dark:text-amber-400",
  shared: "text-amber-800 dark:text-amber-400",
  dormant: "text-muted-foreground",
  healthy: "text-indigo-600 dark:text-indigo-300",
  config: "text-emerald-700 dark:text-emerald-400",
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
                      <HugeiconsIcon
                        icon={ArrowDown01Icon}
                        className={cn(EXPLORER_CHEVRON_CLASS, !open && "-rotate-90")}
                        aria-hidden
                      />
                      <HugeiconsIcon
                        icon={KIND_ICON[group.kind]}
                        className={cn(EXPLORER_ICON_CLASS, explorerIconInk(KIND_WELL[group.kind]))}
                        aria-hidden
                      />
                      <span
                        className={cn(EXPLORER_BAND_LABEL_CLASS, "flex-1")}
                        title={KIND_HINT[group.kind]}
                      >
                        {group.label}
                      </span>
                      <span className={EXPLORER_COUNT_CLASS}>{group.secrets.length}</span>
                    </div>
                  )}
                />
                <CollapsibleContent>
                  <ul className="flex flex-col">
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
 * One selectable vault contract — title + risk, identity on a second line.
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
  const title = row.description?.trim() || row.name;
  const identity = row.kind === "config" ? (row.cleartext ?? "unset") : row.name;
  const showIdentity = identity !== title;
  const posture = contractPosture(row, now);
  const atRisk = posture.primary !== "healthy" && posture.primary !== "config";
  const readers =
    row.readers.length === 0
      ? "no readers"
      : `${row.readers.length} reader${row.readers.length === 1 ? "" : "s"}`;
  const flags = [
    row.origin === "console" ? "console" : null,
    row.kind === "secret" && !isRotateCadence(row.rotate) ? "no rotate" : null,
  ].filter((flag): flag is string => flag !== null);
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        aria-label={`${title}, ${identity}, ${readers}, ${postureLabel(posture.primary)}`}
        onClick={() => onSelect(row.name)}
        className={cn(
          EXPLORER_ROW_CLASS,
          "items-start py-2",
          selected && EXPLORER_ROW_SELECTED_CLASS,
        )}
      >
        <span
          aria-hidden
          className={cn(EXPLORER_RAIL_CLASS, selected && "bg-[var(--vault-accent)]")}
          style={{ ["--vault-accent" as string]: VAULT_ACCENT }}
        />
        <ToolbarTip label={postureHint(posture.primary, row.rotate)}>
          <HugeiconsIcon
            icon={POSTURE_ICON[posture.primary]}
            className={cn(
              EXPLORER_ICON_CLASS,
              "mt-0.5",
              explorerIconInk(POSTURE_WELL[posture.primary]),
            )}
            aria-hidden
          />
        </ToolbarTip>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{title}</span>
            {atRisk ? <PostureMark posture={posture} /> : null}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
            {showIdentity ? <span className="min-w-0 truncate font-mono">{identity}</span> : null}
            {showIdentity ? <span aria-hidden>·</span> : null}
            <span className="shrink-0 tabular-nums">{readers}</span>
            {flags.map((flag) => (
              <span key={flag} className="shrink-0">
                · {flag}
              </span>
            ))}
          </span>
        </span>
      </button>
    </li>
  );
}

function PostureMark({ posture }: { readonly posture: VaultPosture }): JSX.Element {
  return (
    <span
      role="status"
      className={cn("shrink-0 text-[10px] font-medium", POSTURE_INK[posture.primary])}
    >
      {postureLabel(posture.primary)}
    </span>
  );
}
