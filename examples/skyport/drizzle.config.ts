import { defineConfig } from "drizzle-kit";

/** Domain schema sync for `oke db push|generate|migrate`. */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.OKE_SQLITE_URL ?? "file:.oke/app.sqlite",
  },
});
