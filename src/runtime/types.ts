/**
 * Runtime adapter contract — WinterTC Minimum Common Web API surface
 * plus the few host capabilities (serve, env, files, password) every
 * adapter must expose.
 *
 * Bun is primary (`Bun.serve`); Node / Deno / edge use the web-standard
 * fetch-handler path. Program against Web APIs (`Request`, `Response`,
 * `crypto`, timers); native clients live behind this interface.
 */

/** Default application listen port (O·K·E mnemonic). */
export const APP_PORT = 6530;

/** Default Console listen port (O·K·E mnemonic). */
export const CONSOLE_PORT = 6533;

/** Default MCP listen port (O·K·E mnemonic). */
export const MCP_PORT = 6535;

/**
 * Default docs MCP listen port (read-only documentation search/fetch).
 * Distinct from {@link MCP_PORT} — serves docs content, not a live Manifest.
 */
export const DOCS_MCP_PORT = 6536;

/**
 * Minimal app surface a runtime can serve.
 * Satisfied by {@link import("../kernel/app.ts").OkeApp}.
 */
export interface FetchApp {
  /** Application name (Manifest `app`). */
  readonly name: string;
  /**
   * Web-standard fetch handler — the single request pipeline.
   *
   * @param request - Incoming request
   */
  fetch(request: Request): Response | Promise<Response>;
  /**
   * Adopted bindings (used by the Bun adapter for native `routes`).
   * Optional so plain `{ fetch }` apps still serve.
   */
  readonly bindings?: ReadonlyArray<{
    readonly trigger: {
      readonly kind: string;
      readonly method?: string;
      readonly path?: string;
    };
  }>;
}

/**
 * Options for {@link Runtime.serve}.
 *
 * Host / Origin validation is **mandatory and always on** (console §10.1).
 * There is no flag to disable it.
 */
export interface ServeOptions {
  /** Listen port. Defaults to {@link APP_PORT}. Use `0` for an ephemeral port. */
  readonly port?: number;
  /** Listen hostname. Defaults to `127.0.0.1`. */
  readonly hostname?: string;
  /**
   * Stable {@link Bun.serve} identity for `bun --hot` soft reload.
   * When set, Bun updates handlers on the existing socket instead of
   * opening a second listener.
   */
  readonly id?: string;
  /**
   * Extra hostnames accepted in `Host` / `Origin` (reverse proxies).
   * Always merged with loopback defaults and the listen hostname —
   * never replaces the mandatory check.
   */
  readonly allowedHosts?: readonly string[];
}

/** Handle returned by {@link Runtime.serve}. */
export interface ServerHandle {
  /** Base URL of the listening server (`http://hostname:port/`). */
  readonly url: URL;
  /** Bound port (resolved when `port: 0`). */
  readonly port: number;
  /** Listen hostname. */
  readonly hostname: string;
  /**
   * Secured fetch pipeline — identical to what the listener runs.
   * Edge / Node / Deno adapters expose this as the exportable handler.
   *
   * @param request - Incoming request
   */
  fetch(request: Request): Promise<Response>;
  /**
   * Stop accepting connections.
   *
   * @param closeActiveConnections - When true, abort in-flight work
   */
  stop(closeActiveConnections?: boolean): void | Promise<void>;
}

/** Timer primitives (WinterTC / HTML timers). */
export interface RuntimeTimers {
  /**
   * Resolve after `ms` milliseconds.
   *
   * @param ms - Delay
   */
  sleep(ms: number): Promise<void>;
  /**
   * @param fn - Callback
   * @param ms - Delay
   */
  setTimeout(fn: () => void, ms: number): unknown;
  /**
   * @param id - Handle from {@link RuntimeTimers.setTimeout}
   */
  clearTimeout(id: unknown): void;
  /**
   * @param fn - Callback
   * @param ms - Interval
   */
  setInterval(fn: () => void, ms: number): unknown;
  /**
   * @param id - Handle from {@link RuntimeTimers.setInterval}
   */
  clearInterval(id: unknown): void;
  /** High-resolution monotonic time in milliseconds. */
  now(): number;
}

/** Password algorithm accepted by {@link RuntimeCrypto.hashPassword}. */
export type PasswordAlgorithm = "argon2id" | "bcrypt" | "pbkdf2";

/**
 * Crypto surface — Web Crypto plus password hash/verify.
 * Bun binds `Bun.password`; web-standard uses PBKDF2 via SubtleCrypto.
 */
export interface RuntimeCrypto {
  /** Web Crypto `subtle`. */
  readonly subtle: SubtleCrypto;
  /** RFC 4122 UUID via `crypto.randomUUID`. */
  randomUUID(): string;
  /**
   * Fill a typed array with cryptographically strong random values.
   *
   * @param array - Destination buffer
   */
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  /**
   * Hash a password.
   *
   * @param password - Plaintext
   * @param algorithm - Hash algorithm (Bun default `argon2id`)
   */
  hashPassword(password: string, algorithm?: PasswordAlgorithm): Promise<string>;
  /**
   * Verify a password against a hash from {@link RuntimeCrypto.hashPassword}.
   *
   * @param password - Plaintext
   * @param hash - Stored hash
   */
  verifyPassword(password: string, hash: string): Promise<boolean>;
}

/** Process environment access. */
export interface RuntimeEnv {
  /**
   * @param key - Variable name
   */
  get(key: string): string | undefined;
  /**
   * @param key - Variable name
   */
  has(key: string): boolean;
}

/** Filesystem access for runtime adapters (not flow code — flows use `fx`). */
export interface RuntimeFiles {
  /**
   * Read a file as bytes.
   *
   * @param path - Absolute or cwd-relative path
   */
  read(path: string): Promise<Uint8Array>;
  /**
   * Write bytes or UTF-8 text to a file.
   *
   * @param path - Destination path
   * @param data - Contents
   */
  write(path: string, data: Uint8Array | string): Promise<void>;
  /**
   * @param path - Path to test
   */
  exists(path: string): Promise<boolean>;
}

/** Discriminator for the active adapter. */
export type RuntimeName = "bun" | "web-standard";

/**
 * Runtime adapter — serve HTTP and expose host primitives.
 *
 * All world-facing I/O for the process goes through an adapter; flow code
 * still reaches the world only via `fx`.
 */
export interface Runtime {
  /** Adapter id. */
  readonly name: RuntimeName;
  /**
   * Serve an app. Host / Origin checks run on every request.
   *
   * @param app - Fetch-capable application
   * @param options - Listen + `allowedHosts`
   */
  serve(app: FetchApp, options?: ServeOptions): ServerHandle;
  readonly timers: RuntimeTimers;
  readonly crypto: RuntimeCrypto;
  readonly env: RuntimeEnv;
  readonly files: RuntimeFiles;
}
