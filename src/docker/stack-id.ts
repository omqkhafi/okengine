/**
 * Per-project local stack identity — unique compose project + host ports.
 *
 * `oke dev --docker` must not share one `oke-dev` Postgres across every app on
 * the machine. Identity is a stable short hash of the project cwd.
 */

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { ServiceCredentials } from "./types.ts";
import { DEFAULT_DOCKER_DIR } from "./types.ts";
import { defaultHostPort, envPrefix } from "./helpers.ts";

/**
 * Stable 6-hex id for a project directory (local stacks only).
 *
 * @param cwd - Project root
 */
export function stackInstanceId(cwd: string): string {
  return createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 6);
}

/**
 * Compose project / app slug: `dev-<id>` → Docker name `oke-dev-<id>`.
 *
 * @param cwd - Project root
 */
export function stackAppSlug(cwd: string): string {
  return `dev-${stackInstanceId(cwd)}`;
}

/**
 * Stable 0–999 offset derived from a stack instance id.
 *
 * @param instanceId - 6-hex stack id
 */
export function instancePortOffset(instanceId: string): number {
  return Number.parseInt(instanceId.slice(0, 4), 16) % 1000;
}

/**
 * Host port for a role, offset by instance id so two stacks can run at once.
 *
 * @param role - Role key
 * @param containerPort - Container listen port
 * @param instanceId - 6-hex stack id
 */
export function hostPortForInstance(
  role: string,
  containerPort: number,
  instanceId: string,
): number {
  const n = instancePortOffset(instanceId);
  if (role === "store.sql") return 15_000 + n;
  if (role === "store.kv") return 16_000 + n;
  if (role === "signal") return 17_000 + n;
  if (role === "store.files") return 18_000 + n;
  if (role === "channel.email") return 20_000 + n;
  if (role === "vault") return 22_000 + n;
  if (role === "ai") return 23_000 + n;
  if (role === "pgdog") return 24_000 + n;
  if (role === "proxy") return 25_000 + n;
  return defaultHostPort(role, containerPort) + n;
}

/**
 * Host port for a recipe's additional published port.
 *
 * Built-in roles use disjoint ranges so an offset cannot move Mailpit's UI
 * onto RustFS's API port (for example, `8025 + 975 = 9000`).
 *
 * @param role - Role key
 * @param hostPort - Recipe's default additional host port
 * @param instanceId - 6-hex stack id
 */
export function extraHostPortForInstance(
  role: string,
  hostPort: number,
  instanceId: string,
): number {
  const n = instancePortOffset(instanceId);
  if (role === "store.files") return 19_000 + n;
  if (role === "channel.email") return 21_000 + n;
  if (role === "proxy") return 26_000 + n;
  return hostPort + n;
}

/**
 * Parse role credentials from an existing `.env.docker` body (reuse on restart).
 *
 * @param text - Dotenv contents
 * @param roles - Roles to look up
 */
export function parseStackCredentials(
  text: string,
  roles: readonly string[],
): Record<string, ServiceCredentials> {
  const map = parseDotenv(text);
  const out: Record<string, ServiceCredentials> = {};
  for (const role of roles) {
    const prefix = envPrefix(role);
    const user =
      map.get(`${prefix}_USER`) ?? (role === "store.files" ? map.get("S3_ACCESS_KEY_ID") : "oke");
    const password =
      map.get(`${prefix}_PASSWORD`) ??
      (role === "store.files" ? map.get("S3_SECRET_ACCESS_KEY") : undefined) ??
      // Meilisearch master key is written as OKE_STORE_INDEX_KEY (not *_PASSWORD).
      (role === "store.index" ? map.get("OKE_STORE_INDEX_KEY") : undefined);
    const database = map.get(`${prefix}_DB`) ?? "oke";
    if (user && password && database) {
      out[role] = { user, password, database };
    }
  }
  return out;
}

/** Optional `.env.docker` keys preserved when generated files refresh. */
export const STACK_CONTROL_KEYS = [
  "PGDATA",
  "POSTGRES_INITDB_ARGS",
  "OKE_STORE_KV_MAXMEMORY",
  "OKE_STORE_KV_MAXMEMORY_POLICY",
  "S3_REGION",
  "S3_SESSION_TOKEN",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "MP_MAX_MESSAGES",
  "MP_SMTP_AUTH_ACCEPT_ANY",
  "MP_SMTP_AUTH_ALLOW_INSECURE",
  "OKE_AI_MODEL",
  "OKE_AI_CTX_SIZE",
  "OKE_PROXY_HOST",
  "OKE_PROXY_ACME_EMAIL",
] as const;

/**
 * Read supported user controls from an existing `.env.docker`.
 *
 * @param text - Dotenv contents
 */
export function parseStackControls(text: string): Record<string, string> {
  const parsed = parseDotenv(text);
  return Object.fromEntries(
    STACK_CONTROL_KEYS.flatMap((key) => {
      const value = parsed.get(key);
      return value === undefined ? [] : [[key, value]];
    }),
  );
}

/**
 * Load credentials from `docker/.env.docker` when present.
 *
 * Soft-compat: also reads legacy project-root `.env.docker`.
 *
 * @param cwd - Project root
 * @param roles - Image roles
 */
export async function loadExistingStackCredentials(
  cwd: string,
  roles: readonly string[],
): Promise<Readonly<Record<string, ServiceCredentials>> | undefined> {
  const candidates = [resolve(cwd, DEFAULT_DOCKER_DIR, ".env.docker"), resolve(cwd, ".env.docker")];
  for (const path of candidates) {
    const file = Bun.file(path);
    if (!(await file.exists())) continue;
    const parsed = parseStackCredentials(await file.text(), roles);
    if (Object.keys(parsed).length > 0) return parsed;
  }
  return undefined;
}

/**
 * Load optional controls from `docker/.env.docker` when present.
 *
 * @param cwd - Project root
 */
export async function loadExistingStackControls(
  cwd: string,
): Promise<Readonly<Record<string, string>> | undefined> {
  const candidates = [resolve(cwd, DEFAULT_DOCKER_DIR, ".env.docker"), resolve(cwd, ".env.docker")];
  let controls: Record<string, string> = {};
  for (const path of candidates) {
    const file = Bun.file(path);
    if (!(await file.exists())) continue;
    controls = parseStackControls(await file.text());
    break;
  }
  // create-oke / `oke ai setup` write the chosen model into `.env.local` as a
  // commented hint (active would shadow `docker/.env.docker`). Seed active or
  // commented `OKE_AI_MODEL` on first docker boot so `LLAMA_ARG_DOCKER_REPO`
  // is not stuck on the recipe default (`granite3.3:2b`).
  if (!controls.OKE_AI_MODEL) {
    const localEnv = Bun.file(resolve(cwd, ".env.local"));
    if (await localEnv.exists()) {
      const model = readEnvAssignment(await localEnv.text(), "OKE_AI_MODEL");
      if (model) controls = { ...controls, OKE_AI_MODEL: model };
    }
  }
  return Object.keys(controls).length > 0 ? controls : undefined;
}

function parseDotenv(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    const value = unquoteEnvValue(trimmed.slice(eq + 1));
    map.set(key, value);
  }
  return map;
}

/**
 * Read `KEY=value` from dotenv text — active line wins; otherwise the last
 * `# KEY=value` hint (create-oke / `oke ai setup` leave AI stack keys commented).
 *
 * @param text - Dotenv contents
 * @param key - Variable name
 */
function readEnvAssignment(text: string, key: string): string | undefined {
  const active = parseDotenv(text).get(key)?.trim();
  if (active) return active;
  let hinted: string | undefined;
  const prefix = `# ${key}=`;
  const altPrefix = `#${key}=`;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      hinted = unquoteEnvValue(trimmed.slice(prefix.length));
    } else if (trimmed.startsWith(altPrefix)) {
      hinted = unquoteEnvValue(trimmed.slice(altPrefix.length));
    }
  }
  const value = hinted?.trim();
  return value || undefined;
}

function unquoteEnvValue(raw: string): string {
  let value = raw;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}
