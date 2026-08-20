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
 * 4. Optional `--sql` / wizard choice → `store.sql` pins
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CreateDefaults, CreateProxyId, EnvDriverPins } from "./create-defaults.ts";
import {
  DEFAULT_IMAGES,
  LLAMA_CPP_IMAGE,
  OLLAMA_IMAGE,
  PROXY_IMAGES,
  SGLANG_IMAGE,
  VLLM_IMAGE,
} from "./drivers-catalog.ts";
import { materializeLocalOkengineDependency } from "./local-okengine.ts";
import { packageRoot } from "./templates.ts";

/** SQL store drivers selectable at scaffold time (SQLite removed). */
export const SQL_DRIVERS = ["postgres"] as const;

/** A known store.sql driver id for create-oke. */
export type SqlDriverId = (typeof SQL_DRIVERS)[number];

/** Default when `--sql` / wizard choice is omitted (matches template sources). */
export const DEFAULT_SQL_DRIVER: SqlDriverId = "postgres";

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
 *   no monorepo `devDependencies` — those pull Console UI and other
 *   workspace-only packages into the scaffold)
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
 * Real `DRIVER_DEFAULTS` mirrors (okengine/config) — create-oke has no
 * runtime dependency on okengine, so keep a local copy for sparse pins.
 *
 * Keys with no entry (e.g. `index`, `ai`) always emit every env column.
 */
const PIN_DEFAULTS: Readonly<Partial<Record<string, EnvDriverPins>>> = {
  sql: { dev: "postgres", test: "pglite", prod: "postgres" },
  kv: { dev: "redis", test: "memory", prod: "redis" },
  files: { dev: "s3", test: "memory", prod: "s3" },
  signal: { dev: "redis", test: "memory", prod: "redis" },
  clock: { dev: "postgres", test: "frozen", prod: "postgres" },
  vault: { dev: "env", test: "memory", prod: "vault" },
  email: { dev: "smtp", test: "console", prod: "smtp" },
};

/**
 * Pin `store.sql` `dev` / `prod` in `oke.config.ts` to `driver`.
 *
 * Leaves `test` (and every other facet) untouched. When the template omits
 * `store.sql` (defaults already match), this is a no-op for `postgres`.
 *
 * @param source - Config TypeScript source
 * @param driver - Target store.sql driver
 */
export function transformConfigForSqlDriver(source: string, driver: SqlDriverId): string {
  const sqlRe = /^( {6})sql:\s*\{[\s\S]*?\n\1\}/m;
  if (sqlRe.test(source)) {
    return source.replace(sqlRe, (block) =>
      block
        .replace(/dev:\s*"(?:postgres|pglite|memory)"/, `dev: "${driver}"`)
        .replace(/prod:\s*"(?:postgres|pglite|memory)"/, `prod: "${driver}"`),
    );
  }
  // Sparse template with no sql override — defaults already cover postgres.
  if (driver === "postgres") return source;
  return upsertStoreFacet(source, "sql", {
    dev: driver,
    test: "pglite",
    prod: driver,
  });
}

/**
 * Apply full customize answers to `oke.config.ts` source.
 *
 * Rewrites driver maps and syncs `images` keys for docker-backed roles.
 * Pins that match {@link PIN_DEFAULTS} are omitted (or removed) so scaffolds
 * stay override-only.
 *
 * @param source - Config TypeScript source
 * @param defaults - Customize / reuse payload
 */
export function applyCreateAnswers(source: string, defaults: CreateDefaults): string {
  let next = source;
  next = upsertEnvMap(next, "sql", defaults.drivers.store.sql, { nestedUnderStore: true });
  next = upsertEnvMap(next, "kv", defaults.drivers.store.kv, { nestedUnderStore: true });
  next = upsertEnvMap(next, "files", defaults.drivers.store.files, { nestedUnderStore: true });

  if (defaults.drivers.store.index) {
    next = upsertStoreIndex(next, defaults.drivers.store.index);
  }

  next = upsertEnvMap(next, "signal", defaults.drivers.signal, { nestedUnderStore: false });
  next = upsertEnvMap(next, "clock", defaults.drivers.clock, { nestedUnderStore: false });
  next = upsertEnvMap(next, "vault", defaults.drivers.vault, { nestedUnderStore: false });
  next = upsertChannelEmail(next, defaults.drivers.channel.email);

  if (defaults.drivers.ai) {
    next = upsertAiDrivers(next, defaults.drivers.ai);
  }

  next = syncImages(next, defaults);
  return next;
}

/**
 * Env columns that differ from a known default map (or all columns when none).
 *
 * @param pins - Full three-env pins from the wizard
 * @param defaults - Optional real defaults for this key
 */
function sparsePinEntries(
  pins: EnvDriverPins,
  defaults: EnvDriverPins | undefined,
): ReadonlyArray<readonly ["dev" | "test" | "prod", string]> {
  const envs = ["dev", "test", "prod"] as const;
  if (!defaults) {
    return envs.map((env) => [env, pins[env]] as const);
  }
  return envs.filter((env) => pins[env] !== defaults[env]).map((env) => [env, pins[env]] as const);
}

/**
 * Format an env driver map literal — only keys that differ from defaults.
 *
 * @param pins - Pins
 * @param indentLevel - Indent of the map key (`signal` → 2, `sql`/`email` → 3;
 *   two spaces each). Inner fields use `indentLevel + 1`; the closing `}`
 *   aligns with the key.
 * @param defaultsKey - {@link PIN_DEFAULTS} lookup key (omit for no defaults)
 * @returns Formatted `{ … }` or `null` when every pin matches the default
 */
function formatEnvMap(
  pins: EnvDriverPins,
  indentLevel: number,
  defaultsKey?: string,
): string | null {
  const defaults = defaultsKey !== undefined ? PIN_DEFAULTS[defaultsKey] : undefined;
  const entries = sparsePinEntries(pins, defaults);
  if (entries.length === 0) return null;
  const pad = "  ".repeat(indentLevel + 1);
  const close = "  ".repeat(indentLevel);
  const lines = entries.map(([env, value]) => `${pad}${env}: "${value}",`);
  return `{\n${lines.join("\n")}\n${close}}`;
}

/**
 * Match `key: { … }` at a fixed indentation (store facet = 6, drivers = 4).
 *
 * @param key - Map key
 * @param indent - Leading spaces before the key
 */
function envMapRe(key: string, indent: number): RegExp {
  const pad = " ".repeat(indent);
  return new RegExp(`^${pad}${key}:\\s*\\{[\\s\\S]*?\\n${pad}\\}`, "m");
}

/**
 * Remove a matched env-map block and its trailing comma / blank line.
 *
 * @param source - Config source
 * @param re - Block matcher
 */
function removeMatchedBlock(source: string, re: RegExp): string {
  return source.replace(re, "").replace(/\n{3,}/g, "\n\n");
}

/**
 * Rewrite the `drivers: { … }` body, or throw when missing.
 *
 * @param source - Config source
 * @param rewrite - Maps current body → next body
 */
function mapDriversBody(source: string, rewrite: (body: string) => string): string {
  const drivers = findBraceBlock(source, /drivers:\s*\{/);
  if (!drivers) {
    throw new Error("create-oke: oke.config.ts missing drivers block");
  }
  const body = source.slice(drivers.bodyStart, drivers.bodyEnd);
  return `${source.slice(0, drivers.bodyStart)}${rewrite(body)}${source.slice(drivers.bodyEnd)}`;
}

/**
 * Insert `store: { facet }` (or a facet into an existing store) into drivers.
 *
 * Scoped to the `drivers` block so `images.store` is never touched.
 *
 * @param source - Config source
 * @param key - Store facet key
 * @param pins - Pins (full; formatted sparsely inside)
 */
function upsertStoreFacet(source: string, key: string, pins: EnvDriverPins): string {
  const block = formatEnvMap(pins, 3, key);
  const facetRe = envMapRe(key, 6);
  if (block === null) {
    return mapDriversBody(source, (body) => removeMatchedBlock(body, facetRe));
  }
  return mapDriversBody(source, (body) => {
    if (facetRe.test(body)) {
      return body.replace(facetRe, `      ${key}: ${block}`);
    }
    const storeRe = /^( {4})store:\s*\{/m;
    if (storeRe.test(body)) {
      return body.replace(storeRe, (open) => `${open}\n      ${key}: ${block},`);
    }
    const entry = `    store: {\n      ${key}: ${block},\n    },\n`;
    return `${body}${body.endsWith("\n") ? "" : "\n"}${entry}`;
  });
}

/**
 * Upsert a top-level or store-nested env map; omit when pins match defaults.
 *
 * @param source - Config source
 * @param key - Map key (`sql`, `signal`, …)
 * @param pins - New pins
 * @param options - Nesting
 */
function upsertEnvMap(
  source: string,
  key: string,
  pins: EnvDriverPins,
  options: { readonly nestedUnderStore: boolean },
): string {
  if (options.nestedUnderStore) {
    return upsertStoreFacet(source, key, pins);
  }
  const indent = 2;
  const block = formatEnvMap(pins, indent, key);
  const re = envMapRe(key, 4);
  if (block === null) {
    return mapDriversBody(source, (body) => removeMatchedBlock(body, re));
  }
  return mapDriversBody(source, (body) => {
    if (re.test(body)) {
      return body.replace(re, `    ${key}: ${block}`);
    }
    const entry = `    ${key}: ${block},\n`;
    return `${body}${body.endsWith("\n") ? "" : "\n"}${entry}`;
  });
}

/**
 * Upsert `drivers.channel.email` (creates `drivers.channel` when needed).
 *
 * Never touches `images.channel` (string role pins at the same indent).
 *
 * @param source - Config source
 * @param pins - Email pins
 */
function upsertChannelEmail(source: string, pins: EnvDriverPins): string {
  const block = formatEnvMap(pins, 3, "email");
  // Brace-map `email: { … }` only exists under drivers.channel — images uses
  // `email: "image:tag"`.
  const emailRe = envMapRe("email", 6);
  if (block === null) {
    let next = removeMatchedBlock(source, emailRe);
    next = next.replace(/^( {4})channel:\s*\{\s*\n\1\},?\n/m, "");
    return next;
  }
  if (emailRe.test(source)) {
    return source.replace(emailRe, `      email: ${block}`);
  }
  const drivers = findBraceBlock(source, /drivers:\s*\{/);
  if (drivers) {
    const body = source.slice(drivers.bodyStart, drivers.bodyEnd);
    if (/^ {4}channel:\s*\{/m.test(body)) {
      const nextBody = body.replace(
        /^( {4})channel:\s*\{/m,
        (open) => `${open}\n      email: ${block},`,
      );
      return `${source.slice(0, drivers.bodyStart)}${nextBody}${source.slice(drivers.bodyEnd)}`;
    }
  }
  return insertDriversEntry(source, `    channel: {\n      email: ${block},\n    },`);
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
  // No DRIVER_DEFAULTS table — emit every env column.
  return upsertStoreFacet(source, "index", pins);
}

/**
 * Insert a drivers-body entry before the closing `}` of `drivers: { … }`.
 *
 * @param source - Config source
 * @param entry - Full indented entry including trailing comma
 */
function insertDriversEntry(source: string, entry: string): string {
  return mapDriversBody(source, (body) => {
    const needsNl = !body.endsWith("\n");
    return `${body}${needsNl ? "\n" : ""}${entry}\n`;
  });
}

/**
 * Locate a `{ … }` block by opener regex and brace depth.
 *
 * @param source - Source text
 * @param openRe - Matches through the opening `{`
 */
function findBraceBlock(
  source: string,
  openRe: RegExp,
): {
  readonly start: number;
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly end: number;
} | null {
  const m = openRe.exec(source);
  if (!m) return null;
  const start = m.index;
  const openIdx = start + m[0].length - 1;
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { start, bodyStart: openIdx + 1, bodyEnd: i, end: i + 1 };
    }
  }
  return null;
}

/**
 * Insert or replace top-level `drivers.ai` (never under `channel` / `images`).
 *
 * Replaces an existing `drivers.ai` map; otherwise appends inside `drivers`
 * so sparse templates (no `drivers.channel`) cannot match `images.channel`.
 *
 * @param source - Config source
 * @param pins - AI pins
 */
export function upsertAiDrivers(source: string, pins: EnvDriverPins): string {
  // AI has no DRIVER_DEFAULTS — always emit all three envs.
  const block = formatEnvMap(pins, 2);
  if (block === null) {
    throw new Error("create-oke: ai pins must not be empty");
  }
  const aiRe = envMapRe("ai", 4);
  return mapDriversBody(source, (body) => {
    if (aiRe.test(body)) {
      return body.replace(aiRe, `    ai: ${block}`);
    }
    return `${body}${body.endsWith("\n") ? "" : "\n"}    ai: ${block},\n`;
  });
}

/** Env-column keys that must never appear under `images`. */
const IMAGE_ENV_COLUMNS = new Set(["dev", "test", "prod"]);

/** Known compose role keys written into `images` (dotted, post-flatten). */
const IMAGE_ROLE_KEY = /^(?:store\.(?:sql|kv|files|index)|channel\.email|vault|ai|pgdog|proxy)$/;

/** `images` sub-object keys that nest role facets (mirrors `drivers` nesting). */
const IMAGE_NEST_KEYS = ["store", "channel"] as const;

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
    d.store.sql.dev === "postgres" ||
    d.store.sql.prod === "postgres" ||
    d.store.sql.dev === "pgvector" ||
    d.store.sql.prod === "pgvector"
  ) {
    pin("store.sql", DEFAULT_IMAGES["store.sql"]!);
    if (defaults.pgdog) {
      pin("pgdog", DEFAULT_IMAGES.pgdog!);
    }
  }
  if (d.store.kv.dev === "redis" || d.signal.dev === "redis") {
    pin("store.kv", DEFAULT_IMAGES["store.kv"]!);
  }
  if (d.store.files.dev === "s3") {
    pin("store.files", DEFAULT_IMAGES["store.files"]!);
  }
  if (d.channel.email.dev === "smtp") {
    pin("channel.email", DEFAULT_IMAGES["channel.email"]!);
  }
  if (d.store.index?.dev === "meilisearch") {
    pin("store.index", DEFAULT_IMAGES["store.index"]!);
  }
  if (
    d.ai &&
    (d.ai.dev === "ollama" ||
      d.ai.prod === "ollama" ||
      d.ai.dev === "openai-compatible" ||
      d.ai.prod === "openai-compatible")
  ) {
    pin("ai", aiImageForDefaults(defaults));
  }
  if (defaults.proxy !== "none") {
    pin("proxy", PROXY_IMAGES[defaults.proxy]);
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
  if (provider === "ollama" || defaults.drivers.ai?.dev === "ollama") {
    return OLLAMA_IMAGE;
  }
  if (provider === "vllm") return VLLM_IMAGE;
  if (provider === "sglang") return SGLANG_IMAGE;
  if (provider === "llama-cpp" || defaults.drivers.ai?.dev === "openai-compatible") {
    return LLAMA_CPP_IMAGE;
  }
  return DEFAULT_IMAGES.ai!;
}

/**
 * Locate the `images: { … }` block by brace depth (not the first `}`) so
 * nested `store: { … }` / `channel: { … }` sub-blocks don't close the match
 * early.
 *
 * @param source - Config source
 */
export function findImagesBlock(source: string): {
  readonly start: number;
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly end: number;
} | null {
  const m = /images:\s*\{/.exec(source);
  if (!m) return null;
  const start = m.index;
  const openIdx = start + m[0].length - 1;
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { start, bodyStart: openIdx + 1, bodyEnd: i, end: i + 1 };
    }
  }
  return null;
}

/**
 * Parse dotted role→image pins from an `images` block, flattening one level
 * of `store` / `channel` nesting (mirrors {@link flattenImagesConfig} in
 * `okengine/config`).
 *
 * Skips `//` comment lines and rejects env-column keys (`dev`/`test`/`prod`).
 *
 * @param source - Config source
 */
export function extractImages(source: string): Record<string, string> {
  const block = findImagesBlock(source);
  if (!block) return {};
  const out: Record<string, string> = {};
  let context: (typeof IMAGE_NEST_KEYS)[number] | null = null;
  for (const raw of source.slice(block.bodyStart, block.bodyEnd).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const nestOpen = /^(store|channel):\s*\{\s*$/.exec(line);
    if (nestOpen) {
      context = nestOpen[1] as (typeof IMAGE_NEST_KEYS)[number];
      continue;
    }
    if (line === "}," || line === "}") {
      context = null;
      continue;
    }
    const hit = /^["']?([\w.]+)["']?\s*:\s*"([^"]+)"/.exec(line);
    if (!hit) continue;
    const rawKey = hit[1]!;
    if (IMAGE_ENV_COLUMNS.has(rawKey)) continue;
    const key = context ? `${context}.${rawKey}` : rawKey;
    if (!IMAGE_ROLE_KEY.test(key)) continue;
    out[key] = hit[2]!;
  }
  return out;
}

/**
 * Render dotted role→image pins back into a nested `images: { … }` literal —
 * `store.*` / `channel.*` under their sub-object, everything else flat.
 *
 * @param images - Dotted role → image
 */
function formatImagesBlock(images: Record<string, string>): string {
  const store: Array<[string, string]> = [];
  const channel: Array<[string, string]> = [];
  const flat: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(images)) {
    if (key.startsWith("store.")) store.push([key.slice("store.".length), value]);
    else if (key.startsWith("channel.")) channel.push([key.slice("channel.".length), value]);
    else flat.push([key, value]);
  }
  const lines: string[] = [];
  if (store.length > 0) {
    lines.push("    store: {");
    for (const [k, v] of store) lines.push(`      ${k}: "${v}",`);
    lines.push("    },");
  }
  if (channel.length > 0) {
    lines.push("    channel: {");
    for (const [k, v] of channel) lines.push(`      ${k}: "${v}",`);
    lines.push("    },");
  }
  for (const [k, v] of flat) lines.push(`    ${k}: "${v}",`);
  return `images: {\n${lines.join("\n")}\n  }`;
}

/**
 * @param source - Config source
 * @param images - Dotted role → image
 */
export function replaceImagesBlock(source: string, images: Record<string, string>): string {
  const block = findImagesBlock(source);
  if (!block) {
    throw new Error("create-oke: oke.config.ts missing images block");
  }
  return `${source.slice(0, block.start)}${formatImagesBlock(images)}${source.slice(block.end)}`;
}

/**
 * Add or remove the `images.pgdog` pin (PgDog in front of Postgres).
 *
 * @param source - `oke.config.ts` source
 * @param enabled - When true, pin the default PgDog image
 */
export function applyPgDogToConfig(source: string, enabled: boolean): string {
  const images = extractImages(source);
  if (enabled) {
    if (images.pgdog) return source;
    images.pgdog = DEFAULT_IMAGES.pgdog!;
  } else {
    if (!images.pgdog) return source;
    delete images.pgdog;
  }
  return replaceImagesBlock(source, images);
}

/**
 * Add or remove the `images.proxy` pin (Caddy / Traefik / nginx).
 *
 * @param source - `oke.config.ts` source
 * @param proxy - Wizard / CLI proxy id (`none` clears the pin)
 */
export function applyProxyToConfig(source: string, proxy: CreateProxyId): string {
  const images = extractImages(source);
  if (proxy === "none") {
    if (!images.proxy) return source;
    delete images.proxy;
  } else {
    const image = PROXY_IMAGES[proxy];
    if (images.proxy === image) return source;
    images.proxy = image;
  }
  return replaceImagesBlock(source, images);
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
