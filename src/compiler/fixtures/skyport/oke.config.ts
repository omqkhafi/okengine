import { defineConfig } from "okengine/config";

export default defineConfig({
  drivers: {
    prod: ["postgres", "redis", "s3", "smtp", "vault", "anthropic", "pgvector"],
    store: {
      sql: { dev: { driver: "postgres" }, test: "pglite", prod: { driver: "postgres" } },
      kv: { prod: "redis" },
      files: { prod: "s3" },
      index: { prod: "pgvector" },
    },
    signal: { prod: "redis" },
    vault: { prod: "vault" },
    channel: { email: { prod: "smtp" } },
    ai: { prod: { driver: "anthropic" } },
  },
  images: {
    store: {
      sql: "pgvector/pgvector:pg17",
      kv: "valkey/valkey:8-alpine",
    },
  },
  i18n: { locales: ["en", "ar"], default: "ar", dir: { ar: "rtl" } },
  tenancy: { isolation: "row" },
  topology: "monolith",
});
