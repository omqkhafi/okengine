import { defineConfig } from "okengine/config";

/**
 * Standard starter — local-first Notes.
 * Docker/prod pins stay ready when you switch `oke mode docker`.
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
    },
    signal: {
      local: "memory",
      docker: "redis",
      test: "memory",
      prod: "redis",
    },
    clock: {
      local: "memory",
      docker: "file",
      test: "frozen",
      prod: "file",
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
  },
  images: {
    "store.sql": "postgres:18-alpine",
    "store.kv": "redis:8-alpine",
    "store.files": "rustfs/rustfs:1.0.0-beta.11",
    "channel.email": "axllent/mailpit:v1.22.3",
    vault: "openbao/openbao:2.6.1",
  },
  i18n: { locales: ["en", "ar"], default: "en", dir: { ar: "rtl" } },
});
