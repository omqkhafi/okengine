import { defineConfig } from "okengine/config";
import { dbUrl, dbReplica1, anthropicKey } from "./src/vault";

export default defineConfig({
  // Drivers are named after PROTOCOLS and bind through Bun's native clients
  // (Bun.sql, bun:sqlite, Bun.redis, Bun.S3) — zero npm client dependencies.
  drivers: {
    store: {
      sql: { local: "sqlite", test: "memory",
             prod: { driver: "postgres", url: dbUrl, pool: { max: 20 },
                     replicas: [dbReplica1] } },      // read-only flows auto-route here
      kv:    { local: "memory",   test: "memory", prod: "redis" },   // Redis · Valkey · Dragonfly
      files: { local: "fs",       test: "memory", prod: "s3" },      // S3 · R2 · RustFS · SeaweedFS
      index: { local: "pgvector", test: "memory", prod: "pgvector" },
    },
    signal:  { local: "memory", test: "memory", prod: "postgres" },
    clock:   { local: "memory", test: "frozen", prod: "postgres" },
    vault:   { local: "dotenv", test: "memory", prod: "sops" },      // SOPS/age — committable
    runs:    { local: "files",  test: "memory", prod: "files" },     // Parquet + DuckDB
    channel: {
      email:    { local: "console", prod: "smtp" },
      sms:      { local: "console", prod: "unifonic" },
      whatsapp: { local: "console", prod: "wa-cloud" },
      push:     { local: "console", prod: "fcm" },
    },
    ai: {
      local: "mock",                                   // deterministic — tests never call out
      prod: { driver: "anthropic", key: anthropicKey },
      // no prod default: model choice is never guessed.
      // "openai-compatible" covers vLLM · Groq · Together · LM Studio · most self-hosted
    },
  },

  images: {                                           // vendor choice, keyed by ROLE
    "store.sql": "pgvector/pgvector:pg17",
    "store.kv":  "valkey/valkey:8-alpine",
  },

  i18n:     { locales: ["en", "ar"], default: "ar", dir: { ar: "rtl" } },
  tenancy:  { resolve: (ctx) => ctx.auth.orgId, isolation: "row" },
  topology: "monolith",                               // flip to "services" — code unchanged
  ports:    { app: 6530, console: 6533, mcp: 6535 },  // O·K·E = 6·5·3
  console:  { prod: { enabled: true, auth: "required" } },
});
