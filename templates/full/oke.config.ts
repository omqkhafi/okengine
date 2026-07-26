import { defineConfig } from "okengine/config";

export default defineConfig({
  drivers: {
    store: {
      sql: {
        dev: "sqlite",
        stack: "postgres",
        test: "memory",
        prod: "postgres",
      },
      kv: {
        dev: "memory",
        stack: "redis",
        test: "memory",
        prod: "redis",
      },
    },
    signal: {
      dev: "memory",
      stack: "postgres",
      test: "memory",
      prod: "postgres",
    },
    clock: {
      dev: "memory",
      stack: "postgres",
      test: "frozen",
      prod: "postgres",
    },
    vault: {
      dev: "dotenv",
      stack: "dotenv",
      test: "memory",
      prod: "sops",
    },
    channel: {
      email: {
        dev: "console",
        stack: "smtp",
        test: "console",
        prod: "smtp",
      },
      sms: {
        dev: "console",
        stack: "unifonic",
        test: "console",
        prod: "unifonic",
      },
      whatsapp: {
        dev: "console",
        stack: "wa-cloud",
        test: "console",
        prod: "wa-cloud",
      },
    },
    ai: {
      dev: "mock",
      stack: "mock",
      test: "mock",
    },
  },
  images: {
    "store.sql": "postgres:18-alpine",
    "store.kv": "redis:8-alpine",
  },
  i18n: { locales: ["en", "ar"], default: "en", dir: { ar: "rtl" } },
});
