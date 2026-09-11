/**
 * Measured cells for the hero stage rail — CI budgets on the left of the group,
 * the package contract on the right. Every number comes from `budgets.json`;
 * the build fails before any of them drifts past its cap.
 */

import { BUDGETS_MEASURED_AT, budgetById, formatValueLanding } from "@/lib/budgets";
import { OKE_VERSION } from "@/lib/elements";

/** Core budgets worth a hero line — the three a reader can feel. */
const MEASURED: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: "coldStartMedianMs", label: "cold start" },
  { id: "clientGzipBytes", label: "client" },
  { id: "routingP99Ms", label: "routing p99" },
];

/** Package contract from `package.json` — engine, licence, published version. */
const CONTRACT: ReadonlyArray<string> = ["Bun ≥ 1.4.2", "MIT", `v${OKE_VERSION}`];

/**
 * Facts group for {@link HeroRail} — measured budgets, then the contract.
 */
export function HeroFacts() {
  return (
    <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1.5">
      <dl
        className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5"
        title={`Measured ${BUDGETS_MEASURED_AT}`}
      >
        {MEASURED.map((fact) => {
          const row = budgetById(fact.id);
          return (
            <div key={fact.id} className="flex items-baseline gap-1.5">
              <dt className="tracking-[0.12em] text-fd-muted-foreground/60 uppercase">
                {fact.label}
              </dt>
              <dd className="text-fd-foreground tabular-nums">{formatValueLanding(row)}</dd>
            </div>
          );
        })}
      </dl>
      <p className="flex items-center gap-2 text-fd-muted-foreground/60">
        <span aria-hidden className="hidden sm:inline">
          |
        </span>
        {CONTRACT.join(" · ")}
      </p>
    </div>
  );
}
