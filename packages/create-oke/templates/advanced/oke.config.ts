import { defineConfig } from "okengine/config";

/**
 * Advanced starter — same Notes domain, Docker-first + store.index.
 * `oke dev` always uses Docker Compose (dev). Tests use PGLite / memory.
 * Pin only driver keys that differ from `DRIVER_DEFAULTS` (see okengine/config).
 */
export default defineConfig({
  db: {
    declare: "src/db/schema.decl.ts",
    generated: "src/db/schema.drizzle.ts",
  },
  drivers: {
    store: {
      // No three-env default table — set explicitly when you need search.
      index: {
        test: "memory",
        prod: "meilisearch",
      },
    },
    // Built-in encrypted-at-rest store — lives in Postgres, no extra service.
    // Default `vault.dev` is `"env"`; pin built-in for local Docker-first apps.
    // `oke vault init` prints the master key; set OKE_VAULT_MASTER_KEY to unseal.
    vault: {
      dev: "vault",
    },
    // Opt in: create-oke --ai / oke ai setup writes drivers.ai + models in src/core.ts
  },
  images: {
    store: {
      sql: "postgres:18-alpine",
      kv: "redis:8-alpine",
      files: "rustfs/rustfs:1.0.0-beta.11",
      // index: "getmeili/meilisearch:v1.37",
    },
    channel: {
      email: "axllent/mailpit:v1.22.3",
    },
    // pgdog: "ghcr.io/pgdogdev/pgdog:v0.1.51", // create-oke wizard / --pgdog
    // ai: "ghcr.io/ggml-org/llama.cpp:server-b10290", // or ollama/ollama:0.32.6
  },
  i18n: { locales: ["en"], default: "en" },
});
