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
    <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border sm:grid-cols-3">
      {PORTS.map((surface) => (
        <li key={surface.port} className="flex flex-col gap-2 bg-fd-card px-5 py-5">
          <div className="flex items-baseline gap-2">
            <code className="font-mono text-2xl leading-none font-medium tracking-tight text-fd-foreground">
              :{surface.port}
            </code>
            <span className="font-mono text-[11px] tracking-[0.14em] text-fd-muted-foreground uppercase">
              {surface.surface}
            </span>
          </div>
          <p className="text-sm leading-snug text-fd-muted-foreground">{surface.detail}</p>
        </li>
      ))}
    </ul>
  );
}
