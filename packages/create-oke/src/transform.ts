/**
 * Rewrites applied when copying the bundled starter
 * into a new project.
 *
 * Exactly:
 * 1. `package.json` `"name"` → the user-provided project name
 * 2. `package.json` `"okengine": "file:../.."` → an installable reference
 *    (staged `file:~/.oke/create-oke/okengine` in the monorepo — not the
 *    workspace root; registry version otherwise)
 * 3. Drop monorepo-only files that import paths outside the source tree
 *    (today: `tests/docker.test.ts`)
 * 4. Optional `--sql` / wizard choice → Drizzle dialect + `store.sql` pins
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CreateDefaults, EnvDriverPins } from "./create-defaults.ts";
import {
  DEFAULT_IMAGES,
  LLAMA_CPP_IMAGE,
  OLLAMA_IMAGE,
  SGLANG_IMAGE,
  VLLM_IMAGE,
} from "./drivers-catalog.ts";
import { materializeLocalOkengineDependency } from "./local-okengine.ts";
import { packageRoot } from "./templates.ts";

/** SQL store drivers selectable at scaffold time. */
export const SQL_DRIVERS = ["sqlite", "postgres"] as const;

/** A known store.sql driver id for create-oke. */
export type SqlDriverId = (typeof SQL_DRIVERS)[number];

/** Default when `--sql` / wizard choice is omitted (matches template sources). */
export const DEFAULT_SQL_DRIVER: SqlDriverId = "sqlite";

/**
 * Whether `value` is a known {@link SqlDriverId}.
 *
 * @param value - Candidate string
 */
export function isSqlDriverId(value: string): value is SqlDriverId {
  return (SQL_DRIVERS as readonly string[]).includes(value);
}

/** Shape of an example / scaffolded `package.json`. */
export type ScaffoldPackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  type?: string;
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
};

/**
 * Resolve the `okengine` dependency string written into the scaffolded package.json.
 *
 * - Monorepo / local: staged publish-shaped `file:` package (no workspaces /
 *   no monorepo `devDependencies` — those pull drizzle-zod and trip Bun’s RC
 *   peer check)
 * - Published create-oke: the version of this package (kept in lockstep with okengine)
 *
 * @param localOkengineRoot - Absolute path when available
 */
export function resolveOkengineDependency(localOkengineRoot: string | null): string {
  if (localOkengineRoot) return materializeLocalOkengineDependency(localOkengineRoot);
  const pkgPath = join(packageRoot(), "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

/**
 * Rewrite an example `package.json` for a new project.
 *
 * @param source - Parsed example package.json
 * @param projectName - npm package name for the new project
 * @param okengineDep - Installable okengine dependency string
 */
export function transformPackageJson(
  source: ScaffoldPackageJson,
  projectName: string,
  okengineDep: string,
): ScaffoldPackageJson {
  const dependencies = { ...source.dependencies };
  if (dependencies["okengine"] !== undefined) {
    dependencies["okengine"] = okengineDep;
  }

  return {
    ...source,
    name: projectName,
    // Starter apps always begin at 0.0.1 — never the framework lockstep version.
    version: "0.0.1",
    dependencies,
  };
}

/**
 * Whether a relative path inside a template should be omitted from the scaffold.
 *
 * Skips install/VCS artefacts and monorepo-only tests that import outside the
 * example (e.g. skyport `tests/docker.test.ts` → `../../../src/cli/docker.ts`).
 *
 * @param relativePath - Path relative to the template root (`/`-separated)
 */
export function shouldSkipTemplatePath(relativePath: string): boolean {
  const parts = relativePath.split(/[/\\]/);
  if (parts.includes("node_modules") || parts.includes(".git")) return true;
  const base = parts[parts.length - 1] ?? "";
  if (
    base === "bun.lock" ||
    base === "bun.lockb" ||
    base === "package-lock.json" ||
    base === "yarn.lock" ||
    base === "pnpm-lock.yaml"
  ) {
    return true;
  }
  // Monorepo CI fixture — not part of the four-applications app tree.
  if (relativePath.replace(/\\/g, "/") === "tests/docker.test.ts") return true;
  return false;
}

/**
 * Rewrite a Drizzle schema file to the dialect for `driver`.
 *
 * Templates ship as `sqliteTable` / `drizzle-orm/sqlite-core`. Choosing
 * `postgres` swaps to `pgTable` / `pg-core` (and the reverse is idempotent).
 *
 * @param source - Schema TypeScript source
 * @param driver - Target store.sql driver
 */
export function transformSchemaForSqlDriver(source: string, driver: SqlDriverId): string {
  if (driver === "postgres") {
    return source
      .replaceAll("drizzle-orm/sqlite-core", "drizzle-orm/pg-core")
      .replaceAll("sqliteTable", "pgTable");
  }
  return source
    .replaceAll("drizzle-orm/pg-core", "drizzle-orm/sqlite-core")
    .replaceAll("pgTable", "sqliteTable");
}

/**
 * Pin `store.sql` `local` / `docker` / `prod` in `oke.config.ts` to `driver`.
 *
 * Leaves `test: "memory"` (and every other facet) untouched.
 *
 * @param source - Config TypeScript source
 * @param driver - Target store.sql driver
 */
export function transformConfigForSqlDriver(source: string, driver: SqlDriverId): string {
  return source.replace(/sql:\s*\{[\s\S]*?\n\s*\}/, (block) =>
    block
      .replace(/local:\s*"(?:sqlite|postgres)"/, `local: "${driver}"`)
      .replace(/docker:\s*"(?:sqlite|postgres)"/, `docker: "${driver}"`)
      .replace(/prod:\s*"(?:sqlite|postgres)"/, `prod: "${driver}"`),
  );
}

/**
 * Apply full customize answers to `oke.config.ts` source.
 *
 * Rewrites driver maps and syncs `images` keys for docker-backed roles.
 *
 * @param source - Config TypeScript source
 * @param defaults - Customize / reuse payload
 */
export function applyCreateAnswers(source: string, defaults: CreateDefaults): string {
  let next = source;
  next = replaceEnvMap(next, "sql", defaults.drivers.store.sql, { nestedUnderStore: true });
  next = replaceEnvMap(next, "kv", defaults.drivers.store.kv, { nestedUnderStore: true });
  next = replaceEnvMap(next, "files", defaults.drivers.store.files, { nestedUnderStore: true });

  if (defaults.drivers.store.index) {
    next = upsertStoreIndex(next, defaults.drivers.store.index);
  }

  next = replaceEnvMap(next, "signal", defaults.drivers.signal, { nestedUnderStore: false });
  next = replaceEnvMap(next, "clock", defaults.drivers.clock, { nestedUnderStore: false });
  next = replaceEnvMap(next, "vault", defaults.drivers.vault, { nestedUnderStore: false });
  next = replaceChannelEmail(next, defaults.drivers.channel.email);

  if (defaults.drivers.ai) {
    next = upsertAiDrivers(next, defaults.drivers.ai);
  }

  next = syncImages(next, defaults);
  return next;
}

/**
 * Replace a top-level or store-nested env map block by key name.
 *
 * @param source - Config source
 * @param key - Map key (`sql`, `signal`, …)
 * @param pins - New pins
 * @param options - Nesting
 */
function replaceEnvMap(
  source: string,
  key: string,
  pins: EnvDriverPins,
  options: { readonly nestedUnderStore: boolean },
): string {
  const block = formatEnvMap(pins, options.nestedUnderStore ? 3 : 2);
  // Match `key: { … }` at the driver indentation used in the template.
  const re = new RegExp(`${key}:\\s*\\{[\\s\\S]*?\\n\\s*\\}`, "m");
  if (!re.test(source)) {
    throw new Error(`create-oke: oke.config.ts missing drivers.${key} block`);
  }
  return source.replace(re, `${key}: ${block}`);
}

/**
 * Replace `channel.email` env map.
 *
 * @param source - Config source
 * @param pins - Email pins
 */
function replaceChannelEmail(source: string, pins: EnvDriverPins): string {
  const block = formatEnvMap(pins, 3);
  const re = /email:\s*\{[\s\S]*?\n\s*\}/;
  if (!re.test(source)) {
    throw new Error("create-oke: oke.config.ts missing channel.email block");
  }
  return source.replace(re, `email: ${block}`);
}

/**
 * Insert or replace `store.index` under `drivers.store`.
 *
 * Matches only a real `index:` key at store-facet indentation — never
 * `index: { … }` inside comments (e.g. the images opt-in note).
 *
 * @param source - Config source
 * @param pins - Index pins
 */
function upsertStoreIndex(source: string, pins: EnvDriverPins): string {
  const block = formatEnvMap(pins, 3);
  const indexRe = /^( {6})index:\s*\{[\s\S]*?\n\1\}/m;
  if (indexRe.test(source)) {
    return source.replace(indexRe, `$1index: ${block}`);
  }
  // Insert after files block inside store.
  const filesRe = /(files:\s*\{[\s\S]*?\n\s*\},)/;
  if (!filesRe.test(source)) {
    throw new Error("create-oke: oke.config.ts missing store.files to insert index");
  }
  return source.replace(filesRe, `$1\n      index: ${block},`);
}

/**
 * Insert or replace top-level `drivers.ai` (sibling of `channel`, never nested).
 *
 * Indentation-anchored: only matches `ai:` / `channel:` at the drivers-body
 * indent (4 spaces). The old non-greedy `channel: { … },` regex closed on
 * `email`'s `},` and nested `ai` inside `channel` — hero then showed `ai: —`.
 *
 * @param source - Config source
 * @param pins - AI pins
 */
export function upsertAiDrivers(source: string, pins: EnvDriverPins): string {
  const block = formatEnvMap(pins, 2);
  const aiRe = /^( {4})ai:\s*\{[\s\S]*?\n\1\}/m;
  if (aiRe.test(source)) {
    return source.replace(aiRe, `$1ai: ${block}`);
  }
  const channelRe = /^( {4})channel:\s*\{[\s\S]*?\n\1\},?\n/m;
  if (!channelRe.test(source)) {
    throw new Error("create-oke: oke.config.ts missing channel block to insert ai");
  }
  return source.replace(channelRe, (match) => `${match}    ai: ${block},\n`);
}

/**
 * Format an env driver map literal.
 *
 * @param pins - Pins
 * @param indentLevel - Indent of the map key (`signal` → 2, `sql`/`email` → 3;
 *   two spaces each). Inner fields use `indentLevel + 1`; the closing `}`
 *   aligns with the key. An off-by-one here made `email`'s `},` look like
 *   `channel`'s close, so {@link upsertAiDrivers} nested `ai` under `channel`.
 */
function formatEnvMap(pins: EnvDriverPins, indentLevel: number): string {
  const pad = "  ".repeat(indentLevel + 1);
  const close = "  ".repeat(indentLevel);
  return `{
${pad}local: "${pins.local}",
${pad}docker: "${pins.docker}",
${pad}test: "${pins.test}",
${pad}prod: "${pins.prod}",
${close}}`;
}

/** Env-column keys that must never appear under `images`. */
const IMAGE_ENV_COLUMNS = new Set(["local", "docker", "test", "prod"]);

/** Known compose role keys written into `images`. */
const IMAGE_ROLE_KEY = /^(?:store\.(?:sql|kv|files|index)|channel\.email|vault|ai|pgdog)$/;

/**
 * Keep `images` in sync with chosen docker drivers.
 *
 * Rebuilds from known roles only — never spreads poisoned env-column keys
 * leaked from comments or driver maps.
 *
 * @param source - Config source
 * @param defaults - Answers
 */
function syncImages(source: string, defaults: CreateDefaults): string {
  const existing = extractImages(source);
  const images: Record<string, string> = {};
  const d = defaults.drivers;
  const pin = (role: string, fallback: string): void => {
    images[role] = existing[role] ?? fallback;
  };

  if (
    d.store.sql.docker === "postgres" ||
    d.store.sql.prod === "postgres" ||
    d.store.sql.docker === "pgvector" ||
    d.store.sql.prod === "pgvector"
  ) {
    pin("store.sql", DEFAULT_IMAGES["store.sql"]!);
    pin("pgdog", DEFAULT_IMAGES.pgdog!);
  }
  if (d.store.kv.docker === "redis" || d.signal.docker === "redis") {
    pin("store.kv", DEFAULT_IMAGES["store.kv"]!);
  }
  if (d.store.files.docker === "s3") {
    pin("store.files", DEFAULT_IMAGES["store.files"]!);
  }
  if (d.channel.email.docker === "smtp") {
    pin("channel.email", DEFAULT_IMAGES["channel.email"]!);
  }
  if (d.vault.docker === "openbao") {
    pin("vault", DEFAULT_IMAGES.vault!);
  }
  if (d.store.index?.docker === "meilisearch") {
    pin("store.index", DEFAULT_IMAGES["store.index"]!);
  }
  if (
    d.ai &&
    (d.ai.docker === "ollama" ||
      d.ai.local === "ollama" ||
      d.ai.docker === "openai-compatible" ||
      d.ai.local === "openai-compatible")
  ) {
    pin("ai", aiImageForDefaults(defaults));
  }

  return replaceImagesBlock(source, images);
}

/**
 * Resolve `images.ai` from create-defaults provider / driver pins.
 *
 * @param defaults - Create answers
 */
function aiImageForDefaults(defaults: CreateDefaults): string {
  const provider = defaults.ai.provider;
  if (provider === "ollama" || defaults.drivers.ai?.local === "ollama") {
    return OLLAMA_IMAGE;
  }
  if (provider === "vllm") return VLLM_IMAGE;
  if (provider === "sglang") return SGLANG_IMAGE;
  if (provider === "llama-cpp" || defaults.drivers.ai?.local === "openai-compatible") {
    return LLAMA_CPP_IMAGE;
  }
  return DEFAULT_IMAGES.ai!;
}

/**
 * Parse role→image pins from an `images` block.
 *
 * Skips `//` comment lines and rejects env-column keys (`local`/`docker`/…).
 *
 * @param source - Config source
 */
function extractImages(source: string): Record<string, string> {
  const m = /images:\s*\{([\s\S]*?)\n\s*\},/.exec(source);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    const hit = /["']?([\w.]+)["']?\s*:\s*"([^"]+)"/.exec(trimmed);
    if (!hit) continue;
    const key = hit[1]!;
    if (IMAGE_ENV_COLUMNS.has(key) || !IMAGE_ROLE_KEY.test(key)) continue;
    out[key] = hit[2]!;
  }
  return out;
}

/**
 * @param source - Config source
 * @param images - Role → image
 */
function replaceImagesBlock(source: string, images: Record<string, string>): string {
  const lines = Object.entries(images).map(([k, v]) => {
    const key = k.includes(".") ? `"${k}"` : k;
    return `    ${key}: "${v}",`;
  });
  const block = `images: {\n${lines.join("\n")}\n  }`;
  const re = /images:\s*\{[\s\S]*?\n\s*\}/;
  if (!re.test(source)) {
    throw new Error("create-oke: oke.config.ts missing images block");
  }
  return source.replace(re, block);
}

/**
 * Sanitize a directory / package name for npm.
 *
 * @param raw - User-provided name
 */
export function sanitizeProjectName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("create-oke: project name must not be empty");
  }
  // Allow scoped names; otherwise lowercase npm-safe slug.
  if (trimmed.startsWith("@")) {
    const m = /^(@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*)$/.exec(trimmed);
    if (!m) {
      throw new Error(`create-oke: invalid scoped package name "${trimmed}"`);
    }
    return trimmed;
  }
  const name = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name || !/^[a-z0-9-~]/.test(name)) {
    throw new Error(`create-oke: invalid project name "${raw}"`);
  }
  return name;
}
