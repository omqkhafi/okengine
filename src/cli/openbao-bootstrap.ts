/**
 * OpenBao first-boot bootstrap — real init/unseal for the docker / prod vault.
 *
 * Durability contract (see the plan's three verification gates):
 *
 * 1. Host material lives under `.oke/openbao/` — `.gitignore` covers it,
 *    directory mode `0700`, files `0600`, asserted after every write.
 * 2. `POST /v1/sys/init` is NOT transactional with the host filesystem. We
 *    write material atomically (temp → fsync → rename → chmod → verify) and
 *    only then treat init as successful. When OpenBao is initialized but host
 *    material is missing/corrupt, boot fails loud (permanent-loss message) —
 *    never re-init, never soft-empty.
 * 3. The root token never lands in `docker/.env.docker`; only the minted
 *    least-privilege app token (`OKE_VAULT_TOKEN`) does.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { openSync, fsyncSync, closeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Material directory relative to the project root. */
export const OPENBAO_STATE_DIR_REL = join(".oke", "openbao");
/** OpenBao KV mount used by OKE apps. */
export const OPENBAO_MOUNT = "secret";

/** Fetch contract (injectable for tests). */
export type OpenBaoFetch = typeof globalThis.fetch;

/** Options for {@link ensureOpenBao}. */
export interface OpenBaoBootstrapOptions {
  readonly cwd?: string;
  /** Base URL, e.g. `http://127.0.0.1:22042`. */
  readonly url: string;
  /** Declared vault contract names (least-privilege policy scope). */
  readonly names?: readonly string[];
  readonly fetch?: OpenBaoFetch;
  /** Override state dir (tests). */
  readonly stateDir?: string;
}

/** Result of a successful bootstrap. */
export interface OpenBaoBootstrapResult {
  readonly url: string;
  /** App token bound to the `oke-app` policy (never root). */
  readonly appToken: string;
  /** Absolute path to the state dir that holds root token + unseal key. */
  readonly stateDir: string;
  /** Whether this run performed first-time init. */
  readonly initializedNow: boolean;
}

/** Fail-loud bootstrap error (sealed with no key / unreachable / permanent loss). */
export class OpenBaoBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenBaoBootstrapError";
  }
}

interface SysSealStatus {
  readonly sealed: boolean;
  readonly initialized?: boolean;
}

/**
 * Assert real filesystem modes (`0600` file / `0700` dir) — not a comment.
 *
 * @param path - File or directory
 * @param expected - Expected `mode & 0o777`
 */
export function assertMode(path: string, expected: number): void {
  const mode = statSync(path).mode & 0o777;
  if (mode !== expected) {
    throw new OpenBaoBootstrapError(
      `openbao bootstrap: ${path} mode ${mode.toString(8)} — expected ${expected.toString(8)}`,
    );
  }
}

/**
 * Atomically write `0600` material: temp → fsync → rename → chmod → re-read.
 *
 * @param path - Destination
 * @param value - Contents
 */
function writeMaterial(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  chmodSync(dirname(path), 0o700);
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${value}\n`, { mode: 0o600 });
  const fd = openSync(tmp, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  chmodSync(path, 0o600);
  assertMode(path, 0o600);
  const back = readFileSync(path, "utf8").trim();
  if (back !== value) {
    throw new OpenBaoBootstrapError(`openbao bootstrap: verify failed reading ${path}`);
  }
}

async function api<T>(fetchFn: OpenBaoFetch, url: string, init?: RequestInit): Promise<T> {
  const res = await fetchFn(url, init);
  if (!res.ok) {
    throw new OpenBaoBootstrapError(
      `openbao bootstrap: ${init?.method ?? "GET"} ${url} → ${res.status}`,
    );
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Ensure OpenBao is initialized + unsealed, mint/reuse the app token.
 *
 * Fails loud when: server unreachable · initialized but host unseal key
 * missing/corrupt · still sealed after unseal. Never re-inits an existing
 * backend; never writes root material into the compose env.
 *
 * @param options - URL / cwd / declared names
 */
export async function ensureOpenBao(
  options: OpenBaoBootstrapOptions,
): Promise<OpenBaoBootstrapResult> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const url = options.url.replace(/\/$/, "");
  const stateDir = resolve(options.cwd ?? process.cwd(), options.stateDir ?? OPENBAO_STATE_DIR_REL);
  const unsealPath = join(stateDir, "unseal.key");
  const rootPath = join(stateDir, "root.token");
  const appPath = join(stateDir, "app.token");

  const initHeaders = { "content-type": "application/json" };

  let status: SysSealStatus | undefined;
  const deadline = Date.now() + 30_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      status = await api<SysSealStatus>(fetchFn, `${url}/v1/sys/seal-status`);
      break;
    } catch (err) {
      if (err instanceof OpenBaoBootstrapError) throw err;
      lastErr = err;
      await Bun.sleep(250);
    }
  }
  if (!status) {
    throw new OpenBaoBootstrapError(
      `openbao bootstrap: unreachable at ${url} — ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }

  let initializedNow = false;
  let rootToken: string;
  let unsealKey: string;

  if (!status.initialized) {
    // First boot — init 1-of-1, then make material durable BEFORE success.
    const init = await api<{ keys: string[]; root_token: string }>(fetchFn, `${url}/v1/sys/init`, {
      method: "POST",
      headers: initHeaders,
      body: JSON.stringify({ secret_shares: 1, secret_threshold: 1 }),
    });
    unsealKey = init.keys[0] ?? "";
    rootToken = init.root_token;
    if (!unsealKey || !rootToken) {
      throw new OpenBaoBootstrapError(
        "openbao bootstrap: init returned no unseal key / root token",
      );
    }
    // If this write throws, we fail loud while keys are still in memory.
    mkdirSync(stateDir, { recursive: true });
    chmodSync(stateDir, 0o700);
    writeMaterial(unsealPath, unsealKey);
    writeMaterial(rootPath, rootToken);
    initializedNow = true;
  } else {
    // Initialized — material MUST exist on the host (no re-init, no silent).
    if (!existsSync(unsealPath) || !existsSync(rootPath)) {
      throw new OpenBaoBootstrapError(
        `openbao bootstrap: OpenBao is initialized but ${stateDir} is missing ` +
          `unseal.key/root.token. Without the unseal key the data is unrecoverable. ` +
          `Restore your backup of .oke/openbao/ — permanent loss otherwise.`,
      );
    }
    unsealKey = readFileSync(unsealPath, "utf8").trim();
    rootToken = readFileSync(rootPath, "utf8").trim();
    if (!unsealKey || !rootToken) {
      throw new OpenBaoBootstrapError(
        `openbao bootstrap: ${stateDir} material is empty/corrupt — restore your backup.`,
      );
    }
  }

  // Unseal whenever sealed (every restart).
  let seal = await api<SysSealStatus>(fetchFn, `${url}/v1/sys/seal-status`);
  if (seal.sealed) {
    await api(fetchFn, `${url}/v1/sys/unseal`, {
      method: "POST",
      headers: initHeaders,
      body: JSON.stringify({ key: unsealKey }),
    });
    seal = await api<SysSealStatus>(fetchFn, `${url}/v1/sys/seal-status`);
    if (seal.sealed) {
      throw new OpenBaoBootstrapError("openbao bootstrap: still sealed after unseal");
    }
  }

  const rootHeaders = { "X-Vault-Token": rootToken, "content-type": "application/json" };

  // Enable KV v2 at `secret/` once (mount exists after our first init).
  if (initializedNow) {
    try {
      await api(fetchFn, `${url}/v1/sys/mounts/${OPENBAO_MOUNT}`, {
        method: "POST",
        headers: rootHeaders,
        body: JSON.stringify({ type: "kv", options: { version: "2" } }),
      });
    } catch {
      // Mount may already exist (e.g. re-race); policy sync below still runs.
    }
  }

  // Least-privilege policy scoped to the app's declared secret paths.
  const names = [...new Set(options.names ?? [])].filter((n) => /^[\w.-]+$/.test(n));
  const policy = names
    .flatMap((n) => [
      `path "${OPENBAO_MOUNT}/data/${n}" {\n  capabilities = ["create", "update", "read", "delete"]\n}`,
      `path "${OPENBAO_MOUNT}/metadata/${n}" {\n  capabilities = ["read", "list", "delete"]\n}`,
    ])
    .join("\n\n");
  await api(fetchFn, `${url}/v1/sys/policy/oke-app`, {
    method: "POST",
    headers: rootHeaders,
    body: JSON.stringify({ policy: `${policy}\n` }),
  });

  // Reuse the persisted app token when present; mint once otherwise.
  let appToken = existsSync(appPath) ? readFileSync(appPath, "utf8").trim() : "";
  if (!appToken) {
    const minted = await api<{ auth: { client_token: string } }>(
      fetchFn,
      `${url}/v1/auth/token/create`,
      {
        method: "POST",
        headers: rootHeaders,
        body: JSON.stringify({ policies: ["oke-app"], ttl: "0" }),
      },
    );
    appToken = minted.auth.client_token;
    writeMaterial(appPath, appToken);
  }

  return { url, appToken, stateDir, initializedNow };
}

/**
 * Build an `OKE_VAULT_*` env overlay for the app / Console from a bootstrap.
 *
 * @param result - Bootstrap result
 */
export function openbaoStackEnv(result: OpenBaoBootstrapResult): Record<string, string> {
  return {
    OKE_VAULT_URL: result.url,
    OKE_VAULT_TOKEN: result.appToken,
    OKE_VAULT_MOUNT: OPENBAO_MOUNT,
  };
}
