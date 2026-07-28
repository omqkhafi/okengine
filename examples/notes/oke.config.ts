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
    },
  },
});
