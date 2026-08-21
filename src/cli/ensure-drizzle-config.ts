/**
 * Ensure a mode-aware `drizzle.config.ts` exists — created when absent,
 * never overwritten when the user customised it.
 */

import { resolve } from "node:path";

/** PostgreSQL-only template (matches create-oke templates' drizzle.config.ts). */
const DRIZZLE_CONFIG_TEMPLATE = `import { defineConfig } from "drizzle-kit";

/**
 * Domain schema sync for \`oke db push|generate|migrate\`.
 *
 * SQL is PostgreSQL-only (postgres / pglite). Domain tables come from
 * \`src/db/schema.decl.ts\` → \`src/db/schema.drizzle.ts\` (emitted as a
 * pre-step of \`oke db\` / \`oke dev\`).
 *
 * System / auth / plugin stubs are separate: \`oke schema generate\` →
 * \`.oke/schema/oke.ts\` (gitignored with \`.oke/\`). Re-run after adding plugins.
 *
 * Versioned prod migrations land in \`./src/db/migrations\`.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.drizzle.ts",
  out: "./src/db/migrations",
  // Domain tables live in public. Schema \`oke\` (RLS) and \`oke_console\` are engine-owned.
  schemaFilter: ["public"],
  tablesFilter: ["!oke_*"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL!,
  },
});
`;

/**
 * Create `drizzle.config.ts` at the project root when it does not exist.
 * Returns the absolute path and whether it was created.
 *
 * @param cwd - Project root
 */
export async function ensureDrizzleConfig(
  cwd: string,
): Promise<{ readonly path: string; readonly created: boolean }> {
  const path = resolve(cwd, "drizzle.config.ts");
  const file = Bun.file(path);
  if (await file.exists()) return { path, created: false };
  await Bun.write(path, DRIZZLE_CONFIG_TEMPLATE);
  return { path, created: true };
}
