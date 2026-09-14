import { defineConfig } from "drizzle-kit";

/**
 * Domain schema sync for `oke db push|generate|migrate`.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/drizzle/index.ts",
  out: "./src/db/migrations",
  schemaFilter: ["public"],
  tablesFilter: ["!oke_*"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL!,
  },
});
