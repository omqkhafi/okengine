/**
 * Aggregated errors explorer — VaultList bands + TraceRow-like leaves.
 */

import { Alert02Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState, type JSX } from "react";
import { ExplorerSearch } from "@/components/explorer/explorer-search.tsx";
import {
  EXPLORER_BAND_CLASS,
  EXPLORER_BAND_HEADER_CLASS,
  EXPLORER_BAND_LABEL_CLASS,
  EXPLORER_COUNT_CLASS,
  EXPLORER_LIST_EMPTY_CLASS,
  EXPLORER_TOOLBAR_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils.ts";
import {
  bandErrorGroups,
  filterErrorGroups,
  type TopErrorGroup,
  type TopErrors,
} from "../lib/top-errors.ts";
import { ErrorRow } from "./error-row.tsx";

/** Props for {@link ErrorList}. */
export interface ErrorListProps {
  readonly errors: TopErrors;
  readonly query: string;
  readonly selectedErrorKey: string | null;
  readonly nowMs: number;
  readonly onQueryChange: (query: string) => void;
  readonly onSelect: (group: TopErrorGroup) => void;
}

/**
 * Left-pane error list with search.
 *
 * @param props - Grouped errors + selection
 */
export function ErrorList({
  errors,
  query,
  selectedErrorKey,
  nowMs,
  onQueryChange,
  onSelect,
}: ErrorListProps): JSX.Element {
  const groups = errors.kind === "groups" ? errors.groups : [];
  const filtered = useMemo(() => filterErrorGroups(groups, query), [groups, query]);
  const bands = useMemo(() => bandErrorGroups(filtered), [filtered]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-slot="monitoring-error-list">
      <div className={EXPLORER_TOOLBAR_CLASS}>
        <ExplorerSearch
          data-slot="monitoring-error-search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter errors…"
          aria-label="Filter errors"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {errors.kind === "empty" ? (
          <p className={EXPLORER_LIST_EMPTY_CLASS} data-slot="monitoring-errors-empty">
            No errors in the Console buffer for this window.
          </p>
        ) : filtered.length === 0 ? (
          <p className={EXPLORER_LIST_EMPTY_CLASS}>No errors match this filter.</p>
        ) : (
          bands.map((band) => (
            <ErrorBand
              key={band.error}
              error={band.error}
              groups={band.groups}
              selectedErrorKey={selectedErrorKey}
              nowMs={nowMs}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ErrorBand({
  error,
  groups,
  selectedErrorKey,
  nowMs,
  onSelect,
}: {
  readonly error: string;
  readonly groups: readonly TopErrorGroup[];
  readonly selectedErrorKey: string | null;
  readonly nowMs: number;
  readonly onSelect: (group: TopErrorGroup) => void;
}): JSX.Element {
  const [open, setOpen] = useState(true);
  const count = groups.reduce((n, g) => n + g.count, 0);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={EXPLORER_BAND_CLASS}>
      <CollapsibleTrigger
        nativeButton={false}
        className={EXPLORER_BAND_HEADER_CLASS}
        render={(props) => (
          <div {...props}>
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground"
              aria-hidden
            >
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className={cn("size-3 transition-transform", !open && "-rotate-90")}
              />
            </span>
            <span className="flex size-5 items-center justify-center rounded-md border border-destructive/40 bg-destructive/10 text-destructive">
              <HugeiconsIcon icon={Alert02Icon} className="size-3" />
            </span>
            <span className={EXPLORER_BAND_LABEL_CLASS}>{error}</span>
            <span className={EXPLORER_COUNT_CLASS}>{count}</span>
          </div>
        )}
      />
      <CollapsibleContent>
        {groups.map((group) => (
          <ErrorRow
            key={group.key}
            group={group}
            selected={group.key === selectedErrorKey}
            nowMs={nowMs}
            onSelect={onSelect}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
