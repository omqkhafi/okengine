/**
 * Template / example ids and resolution.
 *
 * Clean starters live in repo-root `templates/<id>`.
 * Teaching apps live in repo-root `examples/<id>` (`--from-example`).
 * Published installs use the prepack copies under this package.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Clean starter template ids — match repo-root `templates/*`. */
export const TEMPLATES = ["hello", "minimal", "standard", "full"] as const;

/** A known clean starter template. */
export type TemplateId = (typeof TEMPLATES)[number];

/** Default when `--template` is omitted (recommended project layout). */
export const DEFAULT_TEMPLATE: TemplateId = "standard";

/** One-line purpose for each clean template (interactive select + help). */
export const TEMPLATE_PURPOSES: Readonly<Record<TemplateId, string>> = {
  hello: 'Fastest possible "it works" — one flow, no Store',
  minimal: "Smallest shape you'd actually ship — Store + 1–2 flows",
  standard: "Full recommended file layout, empty scaffolding",
  full: "Every element present and wired, no business logic",
};

/** Teaching example ids — match `examples/*` and four-applications.md. */
export const EXAMPLES = ["notes", "linkly", "provisions", "skyport"] as const;

/** A known teaching example. */
export type ExampleId = (typeof EXAMPLES)[number];

/**
 * "New ideas" one-liners from four-applications.md — reused for
 * `--from-example` help and the interactive example select.
 */
export const EXAMPLE_NEW_IDEAS: Readonly<Record<ExampleId, string>> = {
  notes: "`oke`, `on`, `flow`, `http`, `store.sql`, `fx`, typed errors, the typed client.",
  linkly:
    "`signal` and its three delivery physics · `clock` · `gate` · triggers beyond HTTP · transactional emit · cross-unit decoupling.",
  provisions:
    "`durable` flows and the journal · `vault` · `channel` with fallback chains and i18n · live queries · plugins · a CDC trigger · the three cache tiers.",
  skyport:
    "the `ai` element (models, prompts, RAG, agents) · multi-tenancy · SLOs and journeys · distributed topology · the three scaling axes.",
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
 * Whether `value` is a known {@link ExampleId}.
 *
 * @param value - Candidate string
 */
export function isExampleId(value: string): value is ExampleId {
  return (EXAMPLES as readonly string[]).includes(value);
}

/**
 * Directory that contains this package (`packages/create-oke`).
 */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * Resolve the directory to copy for a clean `--template`.
 *
 * Order:
 * 1. `CREATE_OKE_TEMPLATES` env (absolute path to a `templates/` tree)
 * 2. Monorepo `templates/<template>` (two levels up from this package)
 * 3. Bundled `templates/<template>` (npm prepack copy)
 *
 * @param template - Template id
 * @returns Absolute path to the template source tree
 */
export function resolveTemplateDir(template: TemplateId): string {
  const envRoot = process.env["CREATE_OKE_TEMPLATES"];
  if (envRoot) {
    const fromEnv = resolve(envRoot, template);
    if (existsSync(fromEnv)) return fromEnv;
  }

  const pkg = packageRoot();
  const monorepo = resolve(pkg, "../../templates", template);
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
 * Resolve the directory to copy for `--from-example`.
 *
 * Order:
 * 1. `CREATE_OKE_EXAMPLES` env (absolute path to an `examples/` tree)
 * 2. Monorepo `examples/<example>` (two levels up from this package)
 * 3. Bundled `examples/<example>` (npm prepack copy)
 *
 * @param example - Example id
 * @returns Absolute path to the example source tree
 */
export function resolveExampleDir(example: ExampleId): string {
  const envRoot = process.env["CREATE_OKE_EXAMPLES"];
  if (envRoot) {
    const fromEnv = resolve(envRoot, example);
    if (existsSync(fromEnv)) return fromEnv;
  }

  const pkg = packageRoot();
  const monorepo = resolve(pkg, "../../examples", example);
  if (existsSync(monorepo)) return monorepo;

  const bundled = resolve(pkg, "examples", example);
  if (existsSync(bundled)) return bundled;

  throw new Error(
    `create-oke: example "${example}" not found.\n` +
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
