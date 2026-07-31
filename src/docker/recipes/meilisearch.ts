/**
 * Meilisearch image recipe — full-text search service (`getmeili/meilisearch`).
 *
 * Data lives on a named volume under `/meili_data`; the master key is injected
 * via `${VAR}` (never cleartext in YAML). The official image is Alpine-based
 * and musl-clean — the glibc binary gap only affects raw host installs.
 */

import type { ImageRecipe } from "../types.ts";

/** Meilisearch FTS service. API on 7700. */
export const meilisearch: ImageRecipe = {
  id: "meilisearch",
  port: 7700,
  match: (i) => /meilisearch|getmeili/i.test(i),
  apply: (s) => ({
    environment: {
      MEILI_MASTER_KEY: "${OKE_STORE_INDEX_KEY}",
      MEILI_ENV: "${OKE_MEILI_ENV:-production}",
      MEILI_NO_ANALYTICS: "true",
    },
    volumes: [`${s.serviceName}-data:/meili_data`],
    healthcheck: {
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:7700/health || exit 1"],
      interval: "5s",
      timeout: "3s",
      retries: 12,
    },
  }),
  url: (_s, c) => `http://${c.host}:${c.port}`,
};
