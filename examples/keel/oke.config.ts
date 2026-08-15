import { defineConfig } from "okengine/config";

/**
 * Keel — Linear-shaped project-management example.
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
        test: "memory",
        prod: "meilisearch",
      },
    },
    vault: {
      dev: "vault",
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
  },
  i18n: { locales: ["en", "ar"], default: "en", dir: { ar: "rtl" } },
});
