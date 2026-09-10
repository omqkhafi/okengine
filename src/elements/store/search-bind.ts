/**
 * Boot helper — register system-owned durable embed CDC consumers for every
 * `.embed()` column in the Manifest. Writer flows stay free of `effects.embeds`.
 */

import type { Manifest } from "../../manifest/types.ts";
import type { Binding } from "../../kernel/on.ts";
import { flow } from "../../kernel/flow.ts";
import {
  applySearchEmbedCdc,
  searchEmbedFlowName,
  tablesNeedingSearchEmbed,
} from "./search-embed-flow.ts";

/**
 * Adopt `_oke_search_embed_<table>` durable CDC bindings for each embed-declared
 * table. Idempotent on flow name — safe to call once at boot after Manifest is
 * known. Prefer {@link adopt} with real CDC {@link Binding}s so
 * `dispatchCdc` runs them (bare `app.adopt([flow])` only registers the flow).
 *
 * @param adopt - App binding adopter (`adoptBinding` inside `oke()`)
 * @param manifest - Project manifest
 */
export function bindSearchEmbedFlows(
  adopt: (binding: Binding) => void,
  manifest: Manifest,
): readonly string[] {
  const tables = tablesNeedingSearchEmbed(manifest);
  const names: string[] = [];
  for (const t of tables) {
    const name = searchEmbedFlowName(t.table);
    names.push(name);
    const models = [...new Set(t.columns.map((c) => c.model ?? "default"))];
    const sqlRef = `sql:${t.store}` as const;
    const embedFlow = flow(name, {
      plane: "operator",
      durable: true,
      effects: {
        reads: [sqlRef],
        writes: [sqlRef],
        embeds: models,
      },
      do: async (payload: { before: unknown; after: unknown }, fx) => {
        await fx.step(`embed:${t.table}`, async () => {
          await applySearchEmbedCdc(
            fx,
            t.table,
            t.pk,
            t.columns,
            {
              before: (payload.before ?? null) as Record<string, unknown> | null,
              after: (payload.after ?? null) as Record<string, unknown> | null,
            },
            sqlRef,
          );
        });
      },
    });
    const binding: Binding = {
      trigger: { kind: "cdc", table: t.table, store: t.store },
      flow: embedFlow,
    };
    adopt(binding);
  }
  return names;
}
