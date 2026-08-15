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
      dev: "openai-compatible",
      test: "mock",
      prod: "openai-compatible",
    },
  },
  images: {
    store: {
      sql: "postgres:18-alpine",
      kv: "redis:8-alpine",
      files: "rustfs/rustfs:1.0.0-beta.11",
      index: "getmeili/meilisearch:v1.37",
    },
    channel: {
      email: "axllent/mailpit:v1.22.3",
    },
    ai: "ghcr.io/ggml-org/llama.cpp:server-b10290",
  },
  i18n: { locales: ["en", "ar"], default: "en", dir: { ar: "rtl" } },
});
