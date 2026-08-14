/**
 * Vault list — secrets / config bands with posture marks.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import type { JSX } from "react";
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
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils.ts";
import { contractPosture, postureLabel, type VaultPosture } from "../lib/posture.ts";
import { VAULT_ACCENT, VAULT_WELL } from "../lib/theme.ts";
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
  secret: "border-[color:var(--vault-accent)]/35",
  config: "border-zinc-500/35 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
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
        {groups.map((group) => (
          <section
            key={group.kind}
            aria-label={group.label}
            className={EXPLORER_BAND_CLASS}
            data-slot="vault-kind-band"
            data-kind={group.kind}
          >
            <div className={EXPLORER_BAND_HEADER_CLASS}>
              <span
                className={cn(EXPLORER_WELL_CLASS, KIND_WELL[group.kind])}
                style={
                  group.kind === "secret"
                    ? {
                        backgroundColor: VAULT_WELL,
                        color: VAULT_ACCENT,
                        ["--vault-accent" as string]: VAULT_ACCENT,
                      }
                    : undefined
                }
                aria-hidden
              >
                <HugeiconsIcon icon={ELEMENT_ICONS.vault.icon} className="size-3" />
              </span>
              <span className={cn(EXPLORER_BAND_LABEL_CLASS, "flex-1")}>{group.label}</span>
              <span className={EXPLORER_COUNT_CLASS}>{group.secrets.length}</span>
            </div>
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
          </section>
        ))}
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
          <span
            className={EXPLORER_WELL_CLASS}
            style={{ backgroundColor: VAULT_WELL, color: VAULT_ACCENT }}
            aria-hidden
          >
            <HugeiconsIcon icon={ELEMENT_ICONS.vault.icon} className="size-3" />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{label}</span>
          <PostureMark posture={posture} />
        </span>
        <span className="flex w-full items-center gap-1.5 pl-7">
          <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
            {row.name}
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

function PostureMark({ posture }: { readonly posture: VaultPosture }): JSX.Element {
  const label = postureLabel(posture.primary);
  return (
    <span
      role="status"
      className={cn(
        "shrink-0 text-[10px]",
        posture.primary === "blast" && "text-destructive",
        posture.primary === "unset" && "text-amber-800 dark:text-amber-400",
        posture.primary === "overdue" && "text-amber-800 dark:text-amber-400",
        posture.primary === "shared" && "text-amber-800 dark:text-amber-400",
        (posture.primary === "dormant" ||
          posture.primary === "healthy" ||
          posture.primary === "config") &&
          "text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}
