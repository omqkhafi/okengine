/**
 * Local Meilisearch lifecycle for `oke dev` (local mode).
 *
 * A Meilisearch server is a fourth moving part only when the app actually
 * opts into the `meilisearch` store.index driver. This module:
 *
 *  - generates the master key once and persists it under `.oke/meilisearch/`
 *    (`0700` dir / `0600` file, atomic write — a single static key),
 *  - resolves the `meilisearch` binary from `PATH` (a documented prerequisite,
 *    like Docker for `--docker`; we never auto-download binaries),
 *  - spawns it via `Bun.spawn` with its own data dir + port, polls `/health`,
 *    and hands back an env overlay (`OKE_STORE_INDEX_URL` / `…_KEY`) plus a
 *    `stop()` that kills the child alongside the app.
 *
 * Fail-loud: missing binary / unhealthy server / never-ready all throw
 * {@link MeilisearchLocalError} — never a silent memory fallback.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Material directory relative to the project root. */
export const MEILISEARCH_STATE_DIR_REL = join(".oke", "meilisearch");
/** Default loopback port for the local server. */
export const MEILISEARCH_LOCAL_PORT = 7700;

/** Fail-loud local Meilisearch error (missing binary / never healthy). */
export class MeilisearchLocalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeilisearchLocalError";
  }
}

/** Options for {@link startLocalMeilisearch}. */
export interface LocalMeilisearchOptions {
  readonly cwd?: string;
  /** Loopback port (default {@link MEILISEARCH_LOCAL_PORT}). */
  readonly port?: number;
  /** Override state dir (tests). */
  readonly stateDir?: string;
  /** Binary name/path resolved via `Bun.which` (default `meilisearch`). */
  readonly binary?: string;
  /** Max ms to wait for `/health` to report available (default 30_000). */
  readonly readyTimeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

/** A running local Meilisearch child. */
export interface LocalMeilisearchHandle {
  /** Base URL the app should talk to. */
  readonly url: string;
  /** Master key (also persisted on disk). */
  readonly masterKey: string;
  /** Env overlay for the app child. */
  readonly overlay: Record<string, string>;
  /** Kill the child (idempotent). */
  readonly stop: () => void;
}

/** Env overlay for the app child. */
export function meilisearchStackEnv(handle: LocalMeilisearchHandle): Record<string, string> {
  return handle.overlay;
}

function writeMaterial(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  chmodSync(dirname(path), 0o700);
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${value}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
  const back = readFileSync(path, "utf8").trim();
  if (back !== value) {
    throw new MeilisearchLocalError(`meilisearch local: verify failed reading ${path}`);
  }
}

/** Read the persisted master key, or generate + persist a fresh one. */
export function ensureMasterKey(stateDir: string): string {
  const keyPath = join(stateDir, "master.key");
  if (existsSync(keyPath)) {
    const key = readFileSync(keyPath, "utf8").trim();
    if (key.length >= 16) return key;
    throw new MeilisearchLocalError(
      `meilisearch local: ${keyPath} exists but is too short — delete it to regenerate`,
    );
  }
  const key = randomBytes(32).toString("hex");
  writeMaterial(keyPath, key);
  return key;
}

/**
 * Start a local Meilisearch server and wait for `/health`.
 *
 * @param options - cwd / port / binary / injected fetch
 */
export async function startLocalMeilisearch(
  options: LocalMeilisearchOptions = {},
): Promise<LocalMeilisearchHandle> {
  const cwd = options.cwd ?? process.cwd();
  const port = options.port ?? MEILISEARCH_LOCAL_PORT;
  const stateDir = options.stateDir ?? resolve(cwd, MEILISEARCH_STATE_DIR_REL);
  const dataDir = join(stateDir, "data");
  const fetchFn = options.fetch ?? globalThis.fetch;
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000;

  const binary = options.binary ?? "meilisearch";
  const resolved = Bun.which(binary);
  if (!resolved) {
    throw new MeilisearchLocalError(
      "meilisearch local: `meilisearch` not found on PATH — install it to use the store.index FTS driver " +
        "(brew install meilisearch · curl -L https://install.meilisearch.com | sh), " +
        "or run `oke dev --docker` instead. OKE never auto-downloads binaries.",
    );
  }

  const masterKey = ensureMasterKey(stateDir);
  mkdirSync(dataDir, { recursive: true });

  const url = `http://127.0.0.1:${port}`;
  const proc = Bun.spawn(
    [
      resolved,
      "--http-addr",
      `127.0.0.1:${port}`,
      "--master-key",
      masterKey,
      "--db-path",
      dataDir,
      "--env",
      "development",
      "--no-analytics",
    ],
    {
      cwd,
      stdout: "ignore",
      stderr: "inherit",
      env: { ...(process.env as Record<string, string>) },
    },
  );

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      proc.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  };

  const deadline = Date.now() + readyTimeoutMs;
  for (;;) {
    if (proc.exitCode !== null) {
      throw new MeilisearchLocalError(
        `meilisearch local: server exited (${proc.exitCode}) before becoming healthy`,
      );
    }
    try {
      const res = await fetchFn(`${url}/health`);
      if (res.ok) break;
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) {
      stop();
      throw new MeilisearchLocalError(
        `meilisearch local: no /health from ${url} within ${readyTimeoutMs}ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return {
    url,
    masterKey,
    overlay: {
      OKE_STORE_INDEX_URL: url,
      OKE_STORE_INDEX_KEY: masterKey,
    },
    stop,
  };
}
