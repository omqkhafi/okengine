/**
 * Shared Gate list rows (Traces sheet + Units contract panel).
 */

import { HugeiconsIcon } from "@hugeicons/react";
import type { JSX } from "react";
import type { TraceGateInfo } from "@/features/flows/traces/trace-gates.ts";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";

const GATE_ACCENT = "#A78BFA";

/** Props for {@link GateList}. */
export interface GateListProps {
  readonly gates: readonly TraceGateInfo[];
  /** Optional heading override (default "Gates"). */
  readonly heading?: string;
}

/**
 * One Gate row — name + Manifest kind/description when declared.
 *
 * @param props - Resolved gate info
 */
export function GateRow({ gate }: { readonly gate: TraceGateInfo }): JSX.Element {
  const meta = [gate.kind, gate.description].filter(Boolean).join(" · ");
  return (
    <li
      className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[11px] hover:bg-muted/60"
      data-slot="trace-gate-row"
    >
      <span
        className="flex size-5 shrink-0 items-center justify-center"
        style={{ color: GATE_ACCENT }}
        aria-hidden
      >
        <HugeiconsIcon icon={ELEMENT_ICONS.gate.icon} className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate font-mono font-medium text-foreground/90">
        {gate.name}
      </span>
      {meta ? (
        <span className="min-w-0 max-w-[55%] truncate text-muted-foreground">{meta}</span>
      ) : (
        <span className="shrink-0 text-muted-foreground">undeclared</span>
      )}
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
    <section className="flex flex-col gap-1.5" data-slot="gate-list" aria-label={heading}>
      <h3 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {heading}
      </h3>
      <ul className="flex flex-col gap-0.5">
        {gates.map((g) => (
          <GateRow key={g.name} gate={g} />
        ))}
      </ul>
    </section>
  );
}
