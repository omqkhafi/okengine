import { defineConfig } from "okengine/config";

export default defineConfig({
  drivers: {
    store: { sql: { dev: "sqlite", test: "memory", prod: "postgres" } },
  },
});
