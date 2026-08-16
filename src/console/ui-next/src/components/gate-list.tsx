/**
 * Shared Gate list rows (Traces sheet + Units contract panel).
 */

import { HugeiconsIcon } from "@hugeicons/react";
import type { JSX } from "react";
import {
  EXPLORER_COUNT_CLASS,
  EXPLORER_ICON_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_STRIP_CLASS,
  SECTION_HEAD_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { cn } from "@/lib/utils.ts";
import { gateChipIcon, type TraceGateInfo } from "@/features/flows/traces/trace-gates.ts";

const GATE_ACCENT = "#A78BFA";

/** Props for {@link GateList}. */
export interface GateListProps {
  readonly gates: readonly TraceGateInfo[];
  /** Optional heading override (default "Gates"). */
  readonly heading?: string;
}

/**
 * One Gate row — kind + name; description on hover.
 *
 * @param props - Resolved gate info
 */
export function GateRow({ gate }: { readonly gate: TraceGateInfo }): JSX.Element {
  const label = gate.variant ?? "undeclared";
  const meta = [gate.variant, gate.description].filter(Boolean).join(" · ") || "undeclared";
  return (
    <li className={EXPLORER_ROW_CLASS} title={meta} data-slot="trace-gate-row">
      <HugeiconsIcon
        icon={gateChipIcon(gate.variant)}
        className={EXPLORER_ICON_CLASS}
        style={{ color: GATE_ACCENT }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate font-mono text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground/90"> {gate.name}</span>
      </span>
    </li>
  );
}

/**
 * Gates section — uppercase heading + rows.
 *
 * @param props - Resolved gate infos
 */
export function GateList({ gates, heading = "Gates" }: GateListProps): JSX.Element | null {
  if (gates.length === 0) return null;
  return (
    <section className="flex flex-col" data-slot="gate-list" aria-label={heading}>
      <div className={EXPLORER_STRIP_CLASS}>
        <h3 className={cn(SECTION_HEAD_CLASS, "flex items-center px-2")}>{heading}</h3>
        <span className={cn(EXPLORER_COUNT_CLASS, "flex items-center")}>{gates.length}</span>
      </div>
      <ul>
        {gates.map((g) => (
          <GateRow key={g.name} gate={g} />
        ))}
      </ul>
    </section>
  );
}
