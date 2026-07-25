/**
 * Ten exports — the whole public vocabulary, listed with the role of each name.
 * Original okengine section (unified-theory §6).
 */

import { EXPORTS } from '@/lib/elements';

/**
 * Grid of the ten exported names and what each one is for.
 */
export function Vocabulary() {
  return (
    <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border sm:grid-cols-2 lg:grid-cols-5">
      {EXPORTS.map((item, i) => (
        <li key={item.name} className="flex flex-col gap-1 bg-fd-card px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <code className="font-mono text-sm font-medium text-fd-foreground">{item.name}</code>
            <span className="font-mono text-[10px] text-fd-muted-foreground/60">
              {String(i + 1).padStart(2, '0')}
            </span>
          </div>
          <p className="text-[11px] leading-snug text-fd-muted-foreground">{item.role}</p>
        </li>
      ))}
    </ul>
  );
}
