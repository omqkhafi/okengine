/**
 * Access key list — user / operator bands.
 */

import { CrownIcon, Key01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { JSX } from "react";
import type { AccessKeyRow } from "@/client.ts";
import {
  EXPLORER_BAND_CLASS,
  EXPLORER_BAND_HEADER_CLASS,
  EXPLORER_BAND_LABEL_CLASS,
  EXPLORER_COUNT_CLASS,
  EXPLORER_ICON_CLASS,
  EXPLORER_LIST_EMPTY_CLASS,
  EXPLORER_RAIL_ACTIVE_CLASS,
  EXPLORER_RAIL_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_ROW_SELECTED_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import type { ElementHugeIcon } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils.ts";

/** Props for {@link AccessList}. */
export interface AccessListProps {
  readonly rows: readonly AccessKeyRow[];
  readonly selectedKey: string | null;
  readonly query: string;
  readonly loading?: boolean;
  readonly onSelect: (id: string) => void;
}

/**
 * Grouped key list. Empty bands stay visible so both planes remain taught.
 *
 * @param props - Filtered rows + selection
 */
export function AccessList({
  rows,
  selectedKey,
  query,
  loading = false,
  onSelect,
}: AccessListProps): JSX.Element {
  const user = rows.filter((row) => row.plane === "user");
  const operator = rows.filter((row) => row.plane === "operator");

  return (
    <div id="access-list" data-slot="access-list" className="min-h-0 flex-1 overflow-y-auto">
      {loading && rows.length === 0 ? <p className={EXPLORER_LIST_EMPTY_CLASS}>Loading…</p> : null}
      {!loading && rows.length === 0 && query.trim().length > 0 ? (
        <p className={EXPLORER_LIST_EMPTY_CLASS}>No keys match.</p>
      ) : null}
      <AccessBand
        label="User"
        icon={UserIcon}
        rows={user}
        selectedKey={selectedKey}
        onSelect={onSelect}
      />
      <AccessBand
        label="Operator"
        icon={CrownIcon}
        rows={operator}
        selectedKey={selectedKey}
        onSelect={onSelect}
      />
    </div>
  );
}

function AccessBand(props: {
  readonly label: string;
  readonly icon: ElementHugeIcon;
  readonly rows: readonly AccessKeyRow[];
  readonly selectedKey: string | null;
  readonly onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <section className={EXPLORER_BAND_CLASS} aria-label={props.label}>
      <div className={EXPLORER_BAND_HEADER_CLASS}>
        <HugeiconsIcon
          icon={props.icon}
          className={cn(EXPLORER_ICON_CLASS, "text-muted-foreground")}
          aria-hidden
        />
        <span className={cn(EXPLORER_BAND_LABEL_CLASS, "flex-1")}>{props.label}</span>
        <span className={EXPLORER_COUNT_CLASS}>{props.rows.length}</span>
      </div>
      {props.rows.map((row) => {
        const selected = row.id === props.selectedKey;
        const revoked = row.revokedAt !== null;
        return (
          <button
            key={row.id}
            type="button"
            data-slot="access-key-row"
            className={cn(EXPLORER_ROW_CLASS, selected && EXPLORER_ROW_SELECTED_CLASS)}
            onClick={() => props.onSelect(row.id)}
          >
            <span className={cn(EXPLORER_RAIL_CLASS, selected && EXPLORER_RAIL_ACTIVE_CLASS)} />
            <HugeiconsIcon
              icon={Key01Icon}
              className={cn(EXPLORER_ICON_CLASS, "text-muted-foreground")}
            />
            <span
              className={cn("min-w-0 truncate", revoked && "text-muted-foreground line-through")}
            >
              {row.name}
            </span>
            {revoked ? (
              <span className="ml-auto text-[10px] text-muted-foreground">revoked</span>
            ) : row.unused90d ? (
              <span className="ml-auto text-[10px] text-amber-700 dark:text-amber-400">unused</span>
            ) : (
              <span className={cn("ml-auto tabular-nums text-[10px] text-muted-foreground")}>
                {row.scopes.length}
              </span>
            )}
          </button>
        );
      })}
    </section>
  );
}
