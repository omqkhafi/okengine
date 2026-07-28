import { defineConfig } from "okengine/config";

export default defineConfig({
  drivers: {
    store:  { sql: { local: "sqlite", test: "memory", prod: "postgres" },
              kv:  { local: "memory", test: "memory", prod: "redis" } },
    signal: { local: "memory", test: "memory", prod: "postgres" },
    clock:  { local: "memory", test: "frozen", prod: "postgres" },
  },
});
