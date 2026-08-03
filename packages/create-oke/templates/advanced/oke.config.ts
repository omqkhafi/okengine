import { defineConfig } from "okengine/config";

/**
 * Advanced starter — same Notes domain, docker-ready driver map.
 * Recommended create path seeds `.oke/mode` as docker.
 */
export default defineConfig({
  drivers: {
    store: {
      sql: {
        local: "sqlite",
        docker: "postgres",
        test: "memory",
        prod: "postgres",
      },
      kv: {
        local: "memory",
        docker: "redis",
        test: "memory",
        prod: "redis",
      },
      files: {
        local: "fs",
        docker: "s3",
        test: "memory",
        prod: "s3",
      },
      // Opt in via create-oke customize or uncomment:
      // index: {
      //   local: "memory",
      //   docker: "meilisearch",
      //   test: "memory",
      //   prod: "meilisearch",
      // },
    },
    signal: {
      local: "memory",
      docker: "redis",
      test: "memory",
      prod: "redis",
    },
    clock: {
      local: "memory",
      docker: "postgres",
      test: "frozen",
      prod: "postgres",
    },
    vault: {
      local: "env",
      docker: "openbao",
      test: "memory",
      prod: "openbao",
    },
    channel: {
      email: {
        local: "console",
        docker: "smtp",
        test: "console",
        prod: "smtp",
      },
    },
    // Opt in: create-oke --ai / oke ai setup writes drivers.ai + src/ai.ts
  },
  images: {
    "store.sql": "postgres:18-alpine",
    "store.kv": "redis:8-alpine",
    "store.files": "rustfs/rustfs:1.0.0-beta.11",
    "channel.email": "axllent/mailpit:v1.22.3",
    vault: "openbao/openbao:2.6.1",
    // "store.index": "getmeili/meilisearch:v1.37",
    // ai: "ollama/ollama:latest",
  },
  i18n: { locales: ["en", "ar"], default: "en", dir: { ar: "rtl" } },
});
