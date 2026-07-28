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
      docker: "dotenv",
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
  },
  i18n: { locales: ["en", "ar"], default: "en", dir: { ar: "rtl" } },
});
