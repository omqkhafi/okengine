import { defineConfig } from "okengine/config";

export default defineConfig({
  drivers: {
    store: {
      sql: { dev: "sqlite", test: "memory", prod: "postgres" },
      kv: { dev: "memory", test: "memory", prod: "redis" },
    },
    signal: { dev: "memory", test: "memory", prod: "postgres" },
    clock: { dev: "memory", test: "frozen", prod: "postgres" },
    vault: { dev: "dotenv", test: "memory", prod: "sops" },
    channel: {
      email: { dev: "console", test: "console", prod: "smtp" },
      sms: { dev: "console", test: "console", prod: "unifonic" },
      whatsapp: { dev: "console", test: "console", prod: "wa-cloud" },
    },
    ai: {
      dev: "mock",
      test: "mock",
    },
  },
  i18n: { locales: ["en", "ar"], default: "en", dir: { ar: "rtl" } },
});
