/**
 * Fleet Sheet — live instances + Clock / Journal lease snapshot.
 */

import type { JSX } from "react";
import type { InstanceDetail, InstancesListPayload } from "@/client.ts";
import {
  EXPLORER_LIST_EMPTY_CLASS,
  EXPLORER_ROW_CLASS,
  SECTION_HEAD_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDuration } from "@/features/flows/traces/format-duration.ts";
import { cn } from "@/lib/utils.ts";

/** Props for {@link InstanceFleetSheet}. */
export interface InstanceFleetSheetProps {
  readonly fleet: InstancesListPayload | null | undefined;
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * Expandable per-instance detail for the Monitoring health strip.
 *
 * @param props - Fleet payload + open state
 */
export function InstanceFleetSheet({ fleet, open, onClose }: InstanceFleetSheetProps): JSX.Element {
  const instances = fleet?.kind === "fleet" ? fleet.instances : [];
  const now = fleet?.kind === "fleet" ? fleet.now : Date.now();

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col sm:max-w-md"
        data-slot="instance-fleet-sheet"
      >
        <SheetHeader>
          <SheetTitle>Instances</SheetTitle>
          <SheetDescription>
            {fleet?.kind === "fleet"
              ? `${fleet.alive} alive — Clock and Journal leases this process holds`
              : "No shared fleet registry on this Console"}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {instances.length === 0 ? (
            <p className={EXPLORER_LIST_EMPTY_CLASS}>
              {fleet?.kind === "fleet"
                ? "Every presence lease has expired."
                : "The registry is unbound (test / no shared store)."}
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {instances.map((row) => (
                <li key={row.id}>
                  <InstanceRow row={row} now={now} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InstanceRow({
  row,
  now,
}: {
  readonly row: InstanceDetail;
  readonly now: number;
}): JSX.Element {
  const age = Math.max(0, now - row.heartbeatAt);
  const clocks = row.clock.map((c) => c.name).join(", ");
  const runs = row.journal.map((j) => j.flow).join(", ");
  return (
    <div className={EXPLORER_ROW_CLASS} data-slot="instance-fleet-row" data-instance-id={row.id}>
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          age < 30_000 ? "bg-emerald-500" : "bg-muted-foreground/50",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{row.id}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          heartbeat {formatDuration(age)} ago
          {row.pid !== undefined ? ` · pid ${row.pid}` : ""}
        </p>
        <p className={`${SECTION_HEAD_CLASS} mt-1.5`}>Clock</p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          {clocks.length > 0 ? clocks : "holding nothing"}
        </p>
        <p className={`${SECTION_HEAD_CLASS} mt-1.5`}>Journal</p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          {runs.length > 0 ? runs : "holding nothing"}
        </p>
      </div>
    </div>
  );
}
