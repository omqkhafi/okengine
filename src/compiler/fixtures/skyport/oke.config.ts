import { defineConfig } from "okengine/config";

export default defineConfig({
  drivers: {
    prod: ["postgres", "redis", "s3", "smtp", "sops", "anthropic", "pgvector"],
    store: {
      sql: { dev: "sqlite", prod: { driver: "postgres" } },
      kv: { prod: "redis" },
      files: { prod: "s3" },
      index: { prod: "pgvector" },
    },
    signal: { prod: "postgres" },
    vault: { prod: "sops" },
    channel: { email: { prod: "smtp" } },
    ai: { prod: { driver: "anthropic" } },
  },
  images: {
    "store.sql": "pgvector/pgvector:pg17",
    "store.kv": "valkey/valkey:8-alpine",
  },
  i18n: { locales: ["en", "ar"], default: "ar", dir: { ar: "rtl" } },
  tenancy: { isolation: "row" },
  topology: "monolith",
});
