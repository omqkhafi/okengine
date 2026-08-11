import { defineConfig } from "okengine/config";

/**
 * Standard starter — Docker-first Notes.
 * `oke dev` always uses Docker Compose (dev). Tests use PGLite / memory.
 * Pin only driver keys that differ from `DRIVER_DEFAULTS` (see okengine/config).
 */
export default defineConfig({
  db: {
    declare: "src/db/schema.decl.ts",
    generated: "src/db/schema.drizzle.ts",
  },
  drivers: {
    // Built-in encrypted-at-rest store — lives in Postgres, no extra service.
    // Default `vault.dev` is `"env"`; pin built-in for local Docker-first apps.
    // `oke vault init` prints the master key; set OKE_VAULT_MASTER_KEY to unseal.
    vault: {
      dev: "vault",
    },
  },
  images: {
    store: {
      sql: "postgres:18-alpine",
      kv: "redis:8-alpine",
      files: "rustfs/rustfs:1.0.0-beta.11",
    },
    channel: {
      email: "axllent/mailpit:v1.22.3",
    },
    // pgdog: "ghcr.io/pgdogdev/pgdog:v0.1.51", // create-oke wizard / --pgdog
    // proxy: "caddy:2-alpine", // or traefik:v3.3 / nginx:1.27-alpine
  },
  i18n: { locales: ["en"], default: "en" },
});
