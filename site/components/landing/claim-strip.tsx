/**
 * Cloudflare-style benefit row under the hero — four CI caps from `budgets.json`.
 * Big figure is the measured value; the mute line is the cap the build fails on.
 */

import { budgetById, formatLimitLanding, formatValueLanding } from "@/lib/budgets";

const CLAIMS: ReadonlyArray<{
  readonly id: string;
  readonly kicker: string;
  readonly body: string;
}> = [
  {
    id: "kernelEdgeGzipBytes",
    kicker: "kernel",
    body: "Edge profile gzip. CI fails the build past the cap.",
  },
  {
    id: "clientGzipBytes",
    kicker: "client",
    body: "Typed runtime you ship to the browser.",
  },
  {
    id: "coldStartMedianMs",
    kicker: "cold start",
    body: "Median boot on Bun — not a prewarm story.",
  },
  {
    id: "routingP99Ms",
    kicker: "routing",
    body: "p99 overhead. If we cannot measure it, we do not claim it.",
  },
];

/**
 * Four measured budget cells, full-bleed under the hero.
 */
export function ClaimStrip() {
  return (
    <section aria-label="Measured caps" className="border-b border-fd-border">
      <dl className="grid grid-cols-2 gap-px bg-fd-border lg:grid-cols-4">
        {CLAIMS.map((claim) => {
          const row = budgetById(claim.id);
          return (
            <div key={claim.id} className="flex flex-col gap-2 bg-fd-card px-5 py-6 sm:px-8">
              <dt className="font-mono text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase">
                {claim.kicker}
              </dt>
              <dd className="font-mono text-2xl tracking-tight text-fd-foreground tabular-nums sm:text-[1.7rem]">
                {formatValueLanding(row)}
              </dd>
              <dd className="font-mono text-[11px] text-fd-muted-foreground/80">
                cap {formatLimitLanding(row)}
              </dd>
              <dd className="text-xs leading-relaxed text-pretty text-fd-muted-foreground">
                {claim.body}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
