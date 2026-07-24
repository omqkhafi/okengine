/**
 * `fx` — the single door to the outside world.
 *
 * All world access goes through this object. Nothing in `src/elements` or
 * user flows may import `node:` / `bun:` modules directly. Every call that
 * touches a declared effect kind is capability-checked and ledgered.
 *
 * Drivers are stubs in v1 (in-memory). The surface is swappable wholesale
 * for deterministic tests (§7.6).
 */

import type { Effects, ResourceRef } from "../manifest/types.ts";
import type { StoreDecl, StoreRuntime } from "../elements/store.ts";
import {
  createCapabilityToken,
  type CapabilityToken,
} from "./capability.ts";
import {
  createEffectLedger,
  recordEffect,
  reversibilityOf,
  type EffectLedger,
} from "./effects.ts";
import { fail, type FailOptions, type FlowFailure } from "./errors.ts";

/** Named ref: plain string or `{ name }` element handle. */
export type NamedRef = string | { readonly name: string };

/** Resolve a {@link NamedRef} to its string id. */
export function resolveName(ref: NamedRef): string {
  return typeof ref === "string" ? ref : ref.name;
}

/** Resolve a store argument to a `facet:name` resource ref. */
export function resolveStoreRef(ref: NamedRef | { readonly ref: ResourceRef }): ResourceRef {
  if (typeof ref === "string") return ref as ResourceRef;
  if ("ref" in ref) return ref.ref;
  return ref.name as ResourceRef;
}

/** Auth principal on the user plane. */
export interface FxAuth {
  readonly userId: string | null;
  readonly scopes: ReadonlySet<string>;
}

/** Operator principal on the Console plane. */
export interface FxOperator {
  readonly id: string | null;
}

/** Active tenant (multi-tenancy as a dimension of `fx`). */
export interface FxTenant {
  readonly id: string | null;
}

/** In-memory clock surface. */
export interface FxClock {
  /** Current epoch-ms (injectable via {@link CreateFxOptions.now}). */
  now(): number;
  /**
   * Durable sleep stub — resolves immediately in v1.
   *
   * @param label - Step label for the journal
   * @param duration - Duration string (e.g. `"7d"`); ignored by the stub
   */
  sleep(label: string, duration: string): Promise<void>;
}

/** In-memory cache surface. */
export interface FxCache {
  /**
   * Get a cached value.
   *
   * @param key - Cache key
   */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /**
   * Set a cached value.
   *
   * @param key - Cache key
   * @param value - Value to store
   * @param ttl - Optional TTL string (ignored by the stub)
   */
  set(key: string, value: unknown, ttl?: string): Promise<void>;
  /**
   * Get-or-set helper.
   *
   * @param key - Cache key
   * @param ttl - TTL string (ignored by the stub)
   * @param produce - Producer when missing
   */
  getOrSet<T>(key: string, ttl: string, produce: () => T | Promise<T>): Promise<T>;
}

/** Structured logger surface. */
export interface FxLog {
  /** Debug line. */
  debug(message: string, data?: Record<string, unknown>): void;
  /** Info line. */
  info(message: string, data?: Record<string, unknown>): void;
  /** Warning line. */
  warn(message: string, data?: Record<string, unknown>): void;
  /** Error line. */
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * In-memory store handle. Read ops record `read`; write ops record `write`.
 * No real driver — data lives in the fx memory map.
 */
export interface FxStoreHandle {
  /** Resource ref this handle is bound to. */
  readonly ref: ResourceRef;
  /**
   * Read a value by key (records a `read` effect).
   *
   * @param key - Row / entry key
   */
  get(key: string): Promise<unknown>;
  /**
   * Write a value by key (records a `write` effect).
   *
   * @param key - Row / entry key
   * @param value - Value to store
   */
  set(key: string, value: unknown): Promise<void>;
  /**
   * Stub select — records a `read` and returns all rows.
   */
  select(): Promise<unknown[]>;
  /**
   * Stub insert — records a `write`.
   *
   * @param row - Row to insert
   */
  insert(row: Record<string, unknown>): Promise<{ id: string }>;
  /**
   * Stub delete — records a `write`.
   *
   * @param key - Row key
   */
  delete(key: string): Promise<boolean>;
}

/** Options for {@link Fx.send}. */
export interface FxSendOptions {
  readonly to?: string;
  readonly via?: readonly NamedRef[];
  readonly data?: Record<string, unknown>;
}

/** Options for {@link Fx.ask}. */
export interface FxAskOptions {
  readonly via?: readonly NamedRef[];
}

/** Options for {@link Fx.search}. */
export interface FxSearchOptions {
  readonly topK?: number;
}

/**
 * The `fx` context object — v1 surface.
 *
 * Implementations must be plain objects so tests can replace `fx` wholesale.
 */
export interface Fx {
/**
 * Open a store handle for `ref` (capability checked on each op).
 *
 * When a {@link CreateFxOptions.storeRuntime} is bound and `ref` is a
 * registered store declaration, returns the driver-backed handle.
 *
 * @param ref - Store resource ref, named handle, or store declaration
 */
  store(
    ref: NamedRef | { readonly ref: ResourceRef } | StoreDecl,
  ): FxStoreHandle;
  /**
   * Emit a signal (records `emit`).
   *
   * @param signal - Signal name or handle
   * @param payload - Payload
   */
  emit(signal: NamedRef, payload?: unknown): Promise<void>;
  /**
   * Call another flow (records `call`). Stub returns `undefined`.
   *
   * @param flow - Flow name or handle
   * @param input - Input payload
   */
  call(flow: NamedRef, input?: unknown): Promise<unknown>;
  /** Clock surface. */
  readonly clock: FxClock;
  /**
   * Read a vault secret (records `secret`).
   *
   * @param secret - Secret name or handle
   */
  vault(secret: NamedRef): string;
  /** Cache surface. */
  readonly cache: FxCache;
  /**
   * Send a channel template (records `send`).
   *
   * @param template - Template name or handle
   * @param opts - Recipient / data
   */
  send(template: NamedRef, opts?: FxSendOptions): Promise<{ ok: true }>;
  /**
   * Ask an AI prompt (records `ask`). Stub returns `{}`.
   *
   * @param prompt - Prompt name or handle
   * @param input - Prompt input
   * @param opts - Model routing opts
   */
  ask(
    prompt: NamedRef,
    input?: unknown,
    opts?: FxAskOptions,
  ): Promise<Record<string, unknown>>;
  /**
   * Similarity search over an index/embed (records `read` on the embed ref).
   *
   * @param embed - Index / embed name or handle
   * @param query - Query text or vector
   * @param opts - Search options
   */
  search(
    embed: NamedRef,
    query: unknown,
    opts?: FxSearchOptions,
  ): Promise<unknown[]>;
  /** Logger. */
  readonly log: FxLog;
  /**
   * i18n stub — returns the key, optionally with JSON params suffix.
   *
   * @param key - Message key
   * @param params - Interpolation params
   */
  t(key: string, params?: Record<string, unknown>): string;
  /** Generate a unique id (UUID). */
  id(): string;
  /** User-plane auth principal. */
  readonly auth: FxAuth;
  /** Operator-plane principal. */
  readonly operator: FxOperator;
  /** Active tenant. */
  readonly tenant: FxTenant;
  /**
   * Flow-boundary failure value (does not throw).
   *
   * @param code - Declared error code (narrowed by clients via `error.code`)
   * @param data - Error payload
   * @param opts - Optional message
   */
  fail<E>(code: string, data: E, opts?: FailOptions): FlowFailure<E>;
  /**
   * Named durable step stub — runs `fn` once (no journal replay in v1).
   *
   * @param name - Step name
   * @param fn - Step body
   */
  step<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
}

/**
 * Dispatch target for {@link Fx.call}. Wired by the app so untriggered
 * flows execute through the same pipeline as triggered ones.
 */
export type FxCallHandler = (
  name: string,
  input: unknown,
) => Promise<unknown>;

/** Options for {@link createFx}. */
export interface CreateFxOptions {
  /** Flow id — used in capability error messages. */
  readonly flow: string;
  /** Declared effects that mint the capability token. */
  readonly effects?: Effects;
  /** Ledger to append to (created if omitted). */
  readonly ledger?: EffectLedger;
  /** Pre-built token (defaults from `flow` + `effects`). */
  readonly capability?: CapabilityToken;
  /** Injectable clock for timestamps / `fx.clock.now`. */
  readonly now?: () => number;
  /** Auth principal. */
  readonly auth?: FxAuth;
  /** Operator principal. */
  readonly operator?: FxOperator;
  /** Tenant. */
  readonly tenant?: FxTenant;
  /** Secret name → value map for `fx.vault`. */
  readonly secrets?: Readonly<Record<string, string>>;
  /** Seed data for in-memory stores: ref → key → value. */
  readonly storeData?: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  /** Optional log sink (defaults to no-op). */
  readonly onLog?: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>,
  ) => void;
  /**
   * Real `fx.call` dispatch. When omitted, calls are ledgered and return
   * `undefined` (v1 stub).
   */
  readonly callHandler?: FxCallHandler;
  /**
   * Optional store runtime (protocol drivers). When set, `fx.store(decl)`
   * opens driver-backed handles; string refs still use the in-memory stub
   * unless registered on the runtime.
   */
  readonly storeRuntime?: StoreRuntime;
  /** Reveal PII through the store runtime (requires `pii:reveal` upstream). */
  readonly revealPii?: boolean;
}

/** Bundle returned by {@link createFxContext}. */
export interface FxContext {
  /** The context object passed into flows. */
  readonly fx: Fx;
  /** Effect ledger for this invocation. */
  readonly ledger: EffectLedger;
  /** Capability token enforcing declared effects. */
  readonly capability: CapabilityToken;
}

/**
 * Create an in-memory `fx` context (v1 stubs, full surface).
 *
 * @param options - Flow identity, declared effects, ledger, principals
 */
export function createFx(options: CreateFxOptions): Fx {
  return createFxContext(options).fx;
}

/**
 * Create `fx` plus its ledger and capability token.
 *
 * @param options - Same as {@link createFx}
 */
export function createFxContext(options: CreateFxOptions): FxContext {
  const ledger = options.ledger ?? createEffectLedger();
  const capability =
    options.capability ??
    createCapabilityToken(options.flow, options.effects ?? {});
  const now = options.now ?? (() => Date.now());
  const secrets = options.secrets ?? {};
  const onLog = options.onLog;

  const stores = new Map<string, Map<string, unknown>>();
  for (const [ref, rows] of Object.entries(options.storeData ?? {})) {
    stores.set(ref, new Map(Object.entries(rows)));
  }
  const cacheStore = new Map<string, unknown>();

  const auth: FxAuth = options.auth ?? {
    userId: null,
    scopes: new Set(),
  };
  const operator: FxOperator = options.operator ?? { id: null };
  const tenant: FxTenant = options.tenant ?? { id: null };

  async function gated<T>(
    kind: Parameters<CapabilityToken["assert"]>[0],
    resource: string,
    body: () => T | Promise<T>,
  ): Promise<T> {
    capability.assert(kind, resource);
    return recordEffect(ledger, kind, resource, now, body);
  }

  function stubStoreHandle(ref: ResourceRef): FxStoreHandle {
    const table = (): Map<string, unknown> => {
      let m = stores.get(ref);
      if (!m) {
        m = new Map();
        stores.set(ref, m);
      }
      return m;
    };

    return {
      ref,
      get(key: string): Promise<unknown> {
        return gated("read", ref, () => table().get(key) ?? null);
      },
      set(key: string, value: unknown): Promise<void> {
        return gated("write", ref, () => {
          table().set(key, value);
        });
      },
      select(): Promise<unknown[]> {
        return gated("read", ref, () => [...table().values()]);
      },
      insert(row: Record<string, unknown>): Promise<{ id: string }> {
        return gated("write", ref, () => {
          const id =
            typeof row.id === "string" ? row.id : crypto.randomUUID();
          table().set(id, { ...row, id });
          return { id };
        });
      },
      delete(key: string): Promise<boolean> {
        return gated("write", ref, () => table().delete(key));
      },
    };
  }

  function storeHandle(
    ref: NamedRef | { readonly ref: ResourceRef } | StoreDecl,
  ): FxStoreHandle {
    const runtime = options.storeRuntime;
    if (runtime && typeof ref === "object" && ref !== null && "facet" in ref) {
      const decl = ref;
      // Lazy proxy: first op opens the driver handle under the flow effects.
      const cache: { handle?: Awaited<ReturnType<StoreRuntime["open"]>> } = {};
      const open = async () => {
        if (!cache.handle) {
          cache.handle = await runtime.open(decl, {
            effects: options.effects ?? {},
            revealPii: options.revealPii,
          });
        }
        return cache.handle;
      };
      return {
        ref: decl.ref,
        async get(key: string) {
          return gated("read", decl.ref, async () => {
            const h = await open();
            if ("get" in h && typeof h.get === "function") {
              return h.get(key);
            }
            return null;
          });
        },
        async set(key: string, value: unknown) {
          return gated("write", decl.ref, async () => {
            const h = await open();
            if ("set" in h && typeof h.set === "function") {
              await h.set(key, value);
            }
          });
        },
        async select() {
          return gated("read", decl.ref, async () => {
            const h = await open();
            if ("select" in h && typeof h.select === "function") {
              const result = h.select();
              if (
                result &&
                typeof result === "object" &&
                "from" in result &&
                typeof result.from === "function"
              ) {
                // Builder form — caller should use fx.store(db).select().from(t)
                // via the runtime handle directly; stub returns [].
                return [];
              }
              return result as unknown as unknown[];
            }
            return [];
          });
        },
        async insert(row: Record<string, unknown>) {
          return gated("write", decl.ref, async () => {
            const id =
              typeof row.id === "string" ? row.id : crypto.randomUUID();
            return { id };
          });
        },
        async delete(key: string) {
          return gated("write", decl.ref, async () => {
            const h = await open();
            if ("delete" in h && typeof h.delete === "function") {
              const result = await (h.delete as (a: string) => Promise<boolean>)(
                key,
              );
              return result;
            }
            return false;
          });
        },
      };
    }
    return stubStoreHandle(resolveStoreRef(ref as NamedRef | { readonly ref: ResourceRef }));
  }

  const clock: FxClock = {
    now,
    async sleep(_label: string, _duration: string): Promise<void> {
      /* durable sleep is a no-op stub in v1 */
    },
  };

  const cache: FxCache = {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return cacheStore.get(key) as T | undefined;
    },
    async set(key: string, value: unknown, _ttl?: string): Promise<void> {
      cacheStore.set(key, value);
    },
    async getOrSet<T>(
      key: string,
      _ttl: string,
      produce: () => T | Promise<T>,
    ): Promise<T> {
      if (cacheStore.has(key)) return cacheStore.get(key) as T;
      const value = await produce();
      cacheStore.set(key, value);
      return value;
    },
  };

  const log: FxLog = {
    debug(message, data) {
      onLog?.("debug", message, data);
    },
    info(message, data) {
      onLog?.("info", message, data);
    },
    warn(message, data) {
      onLog?.("warn", message, data);
    },
    error(message, data) {
      onLog?.("error", message, data);
    },
  };

  const fx: Fx = {
    store(ref) {
      return storeHandle(ref);
    },
    emit(signal, _payload) {
      const name = resolveName(signal);
      return gated("emit", name, async () => undefined);
    },
    call(flow, input) {
      const name = resolveName(flow);
      return gated("call", name, async () => {
        if (options.callHandler) {
          return options.callHandler(name, input);
        }
        return undefined;
      });
    },
    clock,
    vault(secret) {
      const name = resolveName(secret);
      // vault is sync in the public examples; check + record synchronously
      capability.assert("secret", name);
      const timestamp = now();
      const value = secrets[name] ?? `[secret:${name}]`;
      ledger.record({
        kind: "secret",
        resource: name,
        timestamp,
        duration: Math.max(0, now() - timestamp),
        reversibility: reversibilityOf("secret"),
      });
      return value;
    },
    cache,
    send(template, _opts) {
      const name = resolveName(template);
      return gated("send", name, async () => ({ ok: true as const }));
    },
    ask(prompt, _input, _opts) {
      const name = resolveName(prompt);
      return gated("ask", name, async () => ({}));
    },
    search(embed, _query, _opts) {
      const name = resolveName(embed);
      // search is an index read — capability under `reads`
      return gated("read", name, async () => []);
    },
    log,
    t(key, params) {
      if (params === undefined) return key;
      return `${key}:${JSON.stringify(params)}`;
    },
    id() {
      return crypto.randomUUID();
    },
    auth,
    operator,
    tenant,
    fail,
    async step<T>(_name: string, fn: () => T | Promise<T>): Promise<T> {
      return await fn();
    },
  };

  return { fx, ledger, capability };
}
