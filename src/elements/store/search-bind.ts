/**
 * Boot helper — register system-owned durable embed CDC consumers for every
 * `.embed()` column in the Manifest. Writer flows stay free of `effects.embeds`.
 */

import type { Manifest } from "../../manifest/types.ts";
import type { OkeApp } from "../../kernel/app.ts";
import { flow } from "../../kernel/flow.ts";
import {
  applySearchEmbedCdc,
  searchEmbedFlowName,
  tablesNeedingSearchEmbed,
} from "./search-embed-flow.ts";

/**
 * Adopt `_oke_search_embed_<table>` durable flows for each embed-declared table.
 * Idempotent on flow name — safe to call once at boot after Manifest is loaded.
 *
 * @param app - Booted app (dispatchCdc already wired)
 * @param manifest - Project manifest
 */
export function bindSearchEmbedFlows(app: {
  readonly adopt?: (flows: unknown[]) => void;
  readonly dispatchCdc?: OkeApp["dispatchCdc"];
}, manifest: Manifest): readonly string[] {
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
    // Prefer app.adopt when present; otherwise flows are returned for the caller to register.
    if (typeof app.adopt === "function") {
      app.adopt([embedFlow]);
    }
  }
  return names;
}
