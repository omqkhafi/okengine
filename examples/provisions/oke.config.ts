import { defineConfig } from "okengine/config";

export default defineConfig({
  drivers: {
    store: { sql: { local: "sqlite", test: "memory", prod: "postgres" },
             kv:  { local: "memory", test: "memory", prod: "redis" } },
    signal: { local: "memory", test: "memory", prod: "postgres" },
    clock:  { local: "memory", test: "frozen", prod: "postgres" },
    vault:  { local: "dotenv", test: "memory", prod: "sops" },
    channel: {
      email: { local: "console", test: "console", prod: "smtp" },
      sms: { local: "console", test: "console", prod: "unifonic" },
      whatsapp: { local: "console", test: "console", prod: "wa-cloud" },
    },
  },
  i18n: { locales: ["en", "ar"], default: "ar", dir: { ar: "rtl" } },
});
