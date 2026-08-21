import { defineConfig } from "drizzle-kit";

/**
 * Domain schema sync for `oke db push|generate|migrate`.
 *
 * SQL is PostgreSQL-only (postgres / pglite). Domain tables come from
 * `src/db/schema.decl.ts` → `src/db/schema.drizzle.ts` (emitted as a
 * pre-step of `oke db` / `oke dev`).
 *
 * System / auth / plugin stubs are separate: `oke schema generate` →
 * `.oke/schema/oke.ts` (gitignored with `.oke/`). Re-run after adding plugins.
 *
 * Versioned prod migrations land in `./src/db/migrations`.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.drizzle.ts",
  out: "./src/db/migrations",
  // Domain tables live in public. Schema `oke` (RLS) and `oke_console` are engine-owned.
  schemaFilter: ["public"],
  tablesFilter: ["!oke_*"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL!,
  },
});
