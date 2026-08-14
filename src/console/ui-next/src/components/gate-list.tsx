/**
 * Shared Gate list rows (Traces sheet + Units contract panel).
 */

import { HugeiconsIcon } from "@hugeicons/react";
import type { JSX } from "react";
import { SectionHead } from "@/components/explorer/section-head.tsx";
import { gateChipIcon, type TraceGateInfo } from "@/features/flows/traces/trace-gates.ts";

const GATE_ACCENT = "#A78BFA";

/** Props for {@link GateList}. */
export interface GateListProps {
  readonly gates: readonly TraceGateInfo[];
  /** Optional heading override (default "Gates"). */
  readonly heading?: string;
}

/**
 * One Gate chip — kind + name; description on hover.
 *
 * @param props - Resolved gate info
 */
export function GateRow({ gate }: { readonly gate: TraceGateInfo }): JSX.Element {
  const label = gate.variant ?? "undeclared";
  const meta = [gate.variant, gate.description].filter(Boolean).join(" · ") || "undeclared";
  return (
    <li
      className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px]"
      style={{ borderColor: `${GATE_ACCENT}55`, color: GATE_ACCENT }}
      title={meta}
      data-slot="trace-gate-row"
    >
      <HugeiconsIcon icon={gateChipIcon(gate.variant)} className="size-3" aria-hidden />
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground/90">{gate.name}</span>
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
    <section className="flex flex-col gap-2" data-slot="gate-list" aria-label={heading}>
      <SectionHead title={heading} meta={String(gates.length)} />
      <ul className="flex flex-wrap gap-1.5">
        {gates.map((g) => (
          <GateRow key={g.name} gate={g} />
        ))}
      </ul>
    </section>
  );
}
