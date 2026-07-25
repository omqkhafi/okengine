/**
 * Template ids and resolution — always sourced from `examples/<id>`,
 * with a published-package fallback at `templates/<id>` (filled by prepack).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Canonical template ids — match `examples/*` and four-applications.md. */
export const TEMPLATES = ["notes", "linkly", "provisions", "skyport"] as const;

/** A known scaffold template. */
export type TemplateId = (typeof TEMPLATES)[number];

/** Default when `--template` is omitted (smallest quickstart). */
export const DEFAULT_TEMPLATE: TemplateId = "notes";

/**
 * Whether `value` is a known {@link TemplateId}.
 *
 * @param value - Candidate string
 */
export function isTemplateId(value: string): value is TemplateId {
  return (TEMPLATES as readonly string[]).includes(value);
}

/**
 * Directory that contains this package (`packages/create-oke`).
 */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * Resolve the directory to copy for `template`.
 *
 * Order:
 * 1. `CREATE_OKE_EXAMPLES` env (absolute path to an `examples/` tree)
 * 2. Monorepo `examples/<template>` (two levels up from this package)
 * 3. Bundled `templates/<template>` (npm prepack copy)
 *
 * @param template - Template id
 * @returns Absolute path to the template source tree
 */
export function resolveTemplateDir(template: TemplateId): string {
  const envRoot = process.env["CREATE_OKE_EXAMPLES"];
  if (envRoot) {
    const fromEnv = resolve(envRoot, template);
    if (existsSync(fromEnv)) return fromEnv;
  }

  const pkg = packageRoot();
  const monorepo = resolve(pkg, "../../examples", template);
  if (existsSync(monorepo)) return monorepo;

  const bundled = resolve(pkg, "templates", template);
  if (existsSync(bundled)) return bundled;

  throw new Error(
    `create-oke: template "${template}" not found.\n` +
      `  looked at: ${monorepo}\n` +
      `             ${bundled}`,
  );
}

/**
 * Absolute path to the okengine package root when running inside this monorepo.
 *
 * @returns Repo root, or `null` when create-oke is used from a published install
 */
export function resolveLocalOkengineRoot(): string | null {
  const env = process.env["CREATE_OKE_OKENGINE"];
  if (env && existsSync(join(env, "package.json"))) return resolve(env);

  const candidate = resolve(packageRoot(), "../..");
  const pkgPath = join(candidate, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
    return pkg.name === "okengine" ? candidate : null;
  } catch {
    return null;
  }
}
