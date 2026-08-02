import { defineConfig } from "drizzle-kit";

/**
 * Domain schema sync for `oke db push|generate|migrate`.
 *
 * Dialect comes from OKE's `store.sql` driver map (resolved by the CLI and
 * injected as `OKE_DRIZZLE_DIALECT`) — never inferred from `DATABASE_URL`
 * presence. `src/schema.generated.ts` is emitted from `src/schema.decl.ts`
 * for the active dialect as a pre-step of `oke db` / `oke dev`.
 *
 * Versioned prod migrations land in `./drizzle` — never mix with `.oke/`.
 */
const dialect = (process.env.OKE_DRIZZLE_DIALECT ?? "sqlite") as "sqlite" | "postgresql";

export default defineConfig({
  dialect,
  schema: "./src/schema.generated.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      dialect === "postgresql"
        ? (process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL!)
        : (process.env.OKE_SQLITE_URL ?? "file:.oke/app.sqlite"),
  },
});
