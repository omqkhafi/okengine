/**
 * Ensure a mode-aware `drizzle.config.ts` exists — created when absent,
 * never overwritten when the user customised it.
 */

import { resolve } from "node:path";

/** Mode-aware template (matches create-oke templates' drizzle.config.ts). */
const DRIZZLE_CONFIG_TEMPLATE = `import { defineConfig } from "drizzle-kit";

/**
 * Domain schema sync for \`oke db push|generate|migrate\`.
 *
 * Dialect comes from OKE's \`store.sql\` driver map (resolved by the CLI and
 * injected as \`OKE_DRIZZLE_DIALECT\`) — never inferred from \`DATABASE_URL\`
 * presence. \`src/schema.generated.ts\` is emitted from \`src/schema.decl.ts\`
 * for the active dialect as a pre-step of \`oke db\` / \`oke dev\`.
 *
 * Versioned prod migrations land in \`./drizzle\` — never mix with \`.oke/\`.
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
