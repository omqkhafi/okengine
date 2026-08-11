/**
 * Declared effects summary chips for Units contract panel.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import type { JSX } from "react";
import type { Effects } from "../../../../../../manifest/types.ts";
import {
  effectBarColor,
  effectKindIcon,
  EFFECT_KIND_LABEL,
  type RunEffectKind,
} from "@/features/flows/traces/effect-kind.ts";

/** Props for {@link EffectsSummary}. */
export interface EffectsSummaryProps {
  readonly effects: Effects | undefined;
}

type EffectChip = {
  readonly kind: RunEffectKind;
  readonly ref: string;
};

/**
 * Flatten Manifest effects into colored chips.
 *
 * @param props - Manifest effects bag
 */
export function EffectsSummary({ effects }: EffectsSummaryProps): JSX.Element | null {
  const chips = flattenEffects(effects);
  if (chips.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" data-slot="effects-summary" aria-label="Effects">
      <h3 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        Effects
      </h3>
      <ul className="flex flex-wrap gap-1.5">
        {chips.map((c) => {
          const color = effectBarColor(c.kind);
          const Icon = effectKindIcon(c.kind);
          return (
            <li
              key={`${c.kind}:${c.ref}`}
              className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px]"
              style={{ borderColor: `${color}55`, color }}
              title={`${EFFECT_KIND_LABEL[c.kind]} ${c.ref}`}
            >
              <HugeiconsIcon icon={Icon} className="size-3" />
              <span className="text-muted-foreground">{EFFECT_KIND_LABEL[c.kind]}</span>
              <span className="text-foreground/90">{c.ref}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function flattenEffects(effects: Effects | undefined): EffectChip[] {
  if (!effects) return [];
  const out: EffectChip[] = [];
  const push = (
    kind: RunEffectKind,
    refs: readonly (string | { readonly ref?: string })[] | undefined,
  ) => {
    for (const ref of refs ?? []) {
      const s = typeof ref === "string" ? ref : (ref.ref ?? String(ref));
      out.push({ kind, ref: s });
    }
  };
  push("read", effects.reads);
  push("write", effects.writes);
  push("emit", effects.emits);
  push("send", effects.sends);
  push("ask", effects.asks);
  push("secret", effects.secrets);
  push("call", effects.calls);
  return out;
}
