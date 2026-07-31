/**
 * Ten exports — the whole public vocabulary, listed with the role of each name.
 * Original okengine section (unified-theory §6).
 */

import { EXPORTS } from "@/lib/elements";

/**
 * Grid of the ten exported names and what each one is for.
 */
export function Vocabulary() {
  return (
    <div className="@container not-prose w-full max-w-full min-w-0">
      {/* 5-up only when the container is wide enough (homepage); docs stay 2-up. */}
      <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border @min-[48rem]:grid-cols-5">
        {EXPORTS.map((item, i) => (
          <li
            key={item.name}
            className="flex min-w-0 flex-col gap-1 bg-fd-card px-3 py-3 sm:px-4 sm:py-3.5"
          >
            <div className="flex min-w-0 items-baseline justify-between gap-2">
              <code className="min-w-0 truncate font-mono text-sm font-medium text-fd-foreground">
                {item.name}
              </code>
              <span className="shrink-0 font-mono text-[10px] text-fd-muted-foreground/60">
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>
            <p className="text-[11px] leading-snug text-pretty text-fd-muted-foreground">
              {item.role}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
