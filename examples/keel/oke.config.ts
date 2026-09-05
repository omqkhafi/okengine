import { defineConfig } from "okengine/config";

/**
 * Keel — work-management example (Asana / ClickUp / Monday shaped).
 * `oke dev` always uses Docker Compose (dev). Tests use PGLite / memory.
 */
export default defineConfig({
  db: {
    declare: "src/db/schema.decl.ts",
    generated: "src/db/schema.drizzle.ts",
  },
  drivers: {
    store: {
      index: {
        dev: "meilisearch",
        test: "memory",
        prod: "meilisearch",
      },
    },
    vault: {
      dev: "vault",
    },
    ai: {
      // Transport for OpenRouter (registry provider on ai.model). BYO any
      // OpenAI-compatible `/v1` via `OKE_AI_URL` / `baseUrl` — no images.ai.
      dev: "openai-compatible",
      test: "mock",
      prod: "openai-compatible",
    },
  },
  images: {
    store: {
      sql: "postgres:18-alpine",
      kv: "redis:8-alpine",
      files: "rustfs/rustfs:1.0.0-rc.5",
      index: "getmeili/meilisearch:v1.53",
    },
    pgdog: "ghcr.io/pgdogdev/pgdog:v0.1.57",
    channel: {
      email: "axllent/mailpit:v1.31.1",
    },
    // No images.ai — Compose does not manage inference (OpenRouter / BYO URL).
  },
  i18n: { locales: ["en", "ar"], default: "en", dir: { ar: "rtl" } },
});
