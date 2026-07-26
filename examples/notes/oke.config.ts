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
    },
  },
});
