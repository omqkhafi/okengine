/**
 * Three dev surfaces — app, Console, MCP. Original okengine section
 * (README / `docs/spec/console.md`); the mnemonic is O·K·E = 6·5·3.
 */

import { PORTS } from "@/lib/elements";

/**
 * Port cards for the surfaces `oke dev` brings up together.
 */
export function Surfaces() {
  return (
    <div className="@container not-prose w-full max-w-full min-w-0">
      <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border @min-[32rem]:grid-cols-3">
        {PORTS.map((surface) => (
          <li
            key={surface.port}
            className="flex min-w-0 flex-col gap-2 bg-fd-card px-4 py-4 sm:px-5 sm:py-5"
          >
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <code className="font-mono text-2xl leading-none font-medium tracking-tight text-fd-foreground">
                :{surface.port}
              </code>
              <span className="font-mono text-[11px] tracking-[0.14em] text-fd-muted-foreground uppercase">
                {surface.surface}
              </span>
            </div>
            <p className="text-sm leading-snug text-pretty text-fd-muted-foreground">
              {surface.detail}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
