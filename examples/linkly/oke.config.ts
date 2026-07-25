import { defineConfig } from "okengine/config";

export default defineConfig({
  drivers: {
    store:  { sql: { dev: "sqlite", test: "memory", prod: "postgres" },
              kv:  { dev: "memory", test: "memory", prod: "redis" } },
    signal: { dev: "memory", test: "memory", prod: "postgres" },
    clock:  { dev: "memory", test: "frozen", prod: "postgres" },
  },
});
