import { defineConfig } from "okengine/config";

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
      docker: "postgres",
      test: "memory",
      prod: "postgres",
    },
    clock: {
      local: "memory",
      docker: "postgres",
      test: "frozen",
      prod: "postgres",
    },
    vault: {
      local: "dotenv",
      docker: "sops",
      test: "memory",
      prod: "sops",
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
  },
  i18n: { locales: ["en", "ar"], default: "en", dir: { ar: "rtl" } },
});
