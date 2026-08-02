/**
 * Starter template resolution — `templates/standard` · `templates/advanced`.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Supported starter templates. */
export const TEMPLATES = ["standard", "advanced"] as const;

/** A known clean starter template. */
export type TemplateId = (typeof TEMPLATES)[number];

/** Default when `--template` is omitted. */
export const DEFAULT_TEMPLATE: TemplateId = "standard";

/** One-line purpose for the starter (interactive select + help). */
export const TEMPLATE_PURPOSES: Readonly<Record<TemplateId, string>> = {
  standard: "Notes app — local-first (sqlite · memory · console email)",
  advanced: "Notes app — docker-ready (postgres · redis · s3 · openbao)",
};

/** Recommended `.oke/mode` when using recommended defaults (no customize). */
export const TEMPLATE_DEFAULT_MODE: Readonly<Record<TemplateId, "local" | "docker">> = {
  standard: "local",
  advanced: "docker",
};

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
 * Resolve the directory to copy for the starter.
 *
 * Order:
 * 1. `CREATE_OKE_TEMPLATE` env (absolute path to a template)
 * 2. Bundled `templates/<id>/`
 *
 * @param template - Template id
 * @returns Absolute path to the template source tree
 */
export function resolveTemplateDir(template: TemplateId): string {
  const envRoot = process.env["CREATE_OKE_TEMPLATE"];
  if (envRoot && existsSync(envRoot)) return resolve(envRoot);
  const pkg = packageRoot();
  const bundled = resolve(pkg, "templates", template);
  if (existsSync(bundled)) return bundled;

  throw new Error(`create-oke: template "${template}" not found at ${bundled}`);
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
