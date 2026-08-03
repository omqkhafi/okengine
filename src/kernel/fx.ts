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
import type {
  FilesStoreDecl,
  FilesStoreFxHandle,
  IndexStoreDecl,
  IndexStoreFxHandle,
  KvStoreDecl,
  KvStoreFxHandle,
  SelectOrderBuilder,
  SqlStoreDecl,
  StoreDecl,
  StoreHandle,
  StoreRuntime,
  SqlStoreHandle,
} from "../elements/store.ts";
import type { SqlRow } from "../drivers/types.ts";
import type { SignalRuntime } from "../elements/signal.ts";
import type { SignalEmitOptions } from "../drivers/signal-types.ts";
import type { VaultRuntime } from "../elements/vault.ts";
import type { ChannelRuntime } from "../elements/channel.ts";
import type { AiRuntime } from "../elements/ai.ts";
import { parseDurationMs } from "../elements/clock/duration.ts";
import { createCapabilityToken, type CapabilityToken } from "./capability.ts";
import { createEffectLedger, recordEffect, reversibilityOf, type EffectLedger } from "./effects.ts";
import {
  DryRunWriteIsolationError,
  isDryRun,
  recordWouldHaveFired,
  touchDryRunStore,
} from "./dry-run.ts";
import { fail, type FailOptions, type FlowFailure } from "./errors.ts";
import { currentAbortSignal, linkAbort } from "./abort-scope.ts";
import {
  fxAll,
  fxRace,
  fxRetry,
  fxUsing,
  type FxRetryOptions,
  type FxThunk,
} from "./concurrency.ts";
import { maskRedactedDeep, Redacted } from "./redacted.ts";
import type { JournalSession } from "./journal.ts";
import type { RunTelemetry } from "./run-telemetry.ts";
import { translate, type MessageCatalogs } from "../i18n/messages.ts";
import type { AppMessageKey, MessageValues } from "../i18n/types.ts";

export type { FxRetryOptions, FxThunk } from "./concurrency.ts";

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
  /** Whether the identity has completed verification (email / MFA). */
  readonly verified?: boolean;
}

/** Operator principal on the Console plane. */
export interface FxOperator {
  readonly id: string | null;
}

/**
 * Read-only originating identity for audit / attribution.
 * Never consulted by gate evaluation — authorization stays on {@link Fx.auth}.
 */
export interface FxPrincipal {
  readonly userId: string | null;
  readonly operatorId: string | null;
  readonly scopes: ReadonlySet<string>;
  readonly verified?: boolean;
  readonly plane?: "user" | "operator";
}

/**
 * Freeze a principal snapshot for propagation across {@link Fx.call}.
 *
 * @param p - Live or frozen principal
 */
export function freezePrincipal(p: FxPrincipal): FxPrincipal {
  return {
    userId: p.userId,
    operatorId: p.operatorId,
    scopes: new Set(p.scopes),
    ...(p.verified !== undefined ? { verified: p.verified } : {}),
    ...(p.plane !== undefined ? { plane: p.plane } : {}),
  };
}

/** Active tenant (multi-tenancy as a dimension of `fx`). */
export interface FxTenant {
  readonly id: string | null;
}

/** Clock surface on `fx`. */
export interface FxClock {
  /** Current epoch-ms (injectable via {@link CreateFxOptions.now}). */
  now(): number;
  /**
   * Durable sleep — when the flow is `durable`, journals the wake time and
   * survives restart / deploy. Without a journal, resolves immediately
   * (non-durable flows).
   *
   * @param label - Step label for the journal
   * @param duration - Duration string (e.g. `"7d"`, `"2m"`)
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
 * In-memory / stub store handle when no {@link StoreRuntime} is bound.
 * Read ops record `read`; write ops record `write`.
 */
export interface FxStubStoreHandle {
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
  /**
   * Audit-plugin convenience (no-op on the stub).
   *
   * @param _ctx - Unused context
   */
  log(_ctx?: unknown): Promise<void>;
  /** Audit-plugin CLI convenience. */
  exportCsv(): Promise<string>;
}

/**
 * Handle returned by {@link Fx.store} — driver-backed SQL/KV/files/index
 * when a runtime is bound, otherwise the in-memory stub.
 */
export type FxStoreHandle = StoreHandle | FxStubStoreHandle;

/** Options for {@link Fx.send}. */
export interface FxSendOptions {
  readonly to?: string;
  readonly via?: readonly NamedRef[];
  readonly data?: Record<string, unknown>;
  /** Explicit recipient locale (wins over profile / Accept-Language). */
  readonly locale?: string;
  /** Profile locale for the channel resolution chain. */
  readonly profileLocale?: string;
  /** Raw `Accept-Language` header value. */
  readonly acceptLanguage?: string;
}

/** Options for {@link Fx.ask}. */
export interface FxAskOptions {
  readonly via?: readonly NamedRef[];
  /** Flow refs offered as tools — each model call goes through `fx.call`. */
  readonly tools?: readonly NamedRef[];
  /** Bound on tool invocations (default 6). */
  readonly maxSteps?: number;
}

/** Options for {@link Fx.search}. */
export interface FxSearchOptions {
  readonly topK?: number;
}

/** Brand for {@link JsonResult} (kept internal — flows never construct it). */
export const jsonResultBrand: unique symbol = Symbol.for("oke.json");

/** Carrier from {@link FxJson} — status + body read by the response encoder. */
export interface JsonResult<T = unknown> {
  readonly [jsonResultBrand]: true;
  readonly status: number;
  readonly value?: T;
  readonly meta?: Record<string, unknown>;
}

/** True when `value` is an {@link FxJson} carrier. */
export function isJsonResult(value: unknown): value is JsonResult {
  return (
    typeof value === "object" && value !== null && (value as JsonResult)[jsonResultBrand] === true
  );
}

/**
 * JSON response helpers. `fx.json.create` answers 201; `fx.json.ok` can carry
 * a top-level `meta` (Stripe-style `{ data, meta?, error }`);
 * `fx.json.empty` answers 204.
 */
export interface FxJson {
  /** 200 — body `{ data: value, meta?, error: null }`. */
  ok<T>(value: T, opts?: { readonly meta?: Record<string, unknown> }): JsonResult<T>;
  /** 201 — body `{ data: value, error: null }`. */
  create<T>(value: T): JsonResult<T>;
  /** 204 — no body. */
  empty(): JsonResult<never>;
  /** 200 — body `{ data, meta, error: null }` (paginated lists). */
  with<T>(data: T, meta: Record<string, unknown>): JsonResult<T>;
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
   * facet declaration, returns the driver-backed handle for that facet.
   * String / `{ ref }` forms return the in-memory stub (tests).
   *
   * @param ref - Store resource ref, named handle, or store declaration
   */
  store(ref: SqlStoreDecl): SqlStoreHandle;
  store(ref: KvStoreDecl): KvStoreFxHandle;
  store(ref: FilesStoreDecl): FilesStoreFxHandle;
  store(ref: IndexStoreDecl): IndexStoreFxHandle;
  store(ref: NamedRef | { readonly ref: ResourceRef } | StoreDecl): FxStoreHandle;
  /**
   * Emit a signal (records `emit`).
   *
   * @param signal - Signal name or handle
   * @param payload - Payload
   * @param options - Optional emit options (`key` for per-key once ordering)
   */
  emit(signal: NamedRef, payload?: unknown, options?: SignalEmitOptions): Promise<void>;
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
   * Returns a {@link Redacted} — printing / logging / serializing it yields a
   * placeholder, never the value. Call `.reveal()` at the one boundary that
   * needs the real value (e.g. passing a credential to a driver).
   *
   * @param secret - Secret name or handle
   */
  vault(secret: NamedRef): Redacted<string>;
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
  ask(prompt: NamedRef, input?: unknown, opts?: FxAskOptions): Promise<Record<string, unknown>>;
  /**
   * Similarity search over an index/embed (records `read` on the embed ref).
   *
   * @param embed - Index / embed name or handle
   * @param query - Query text or vector
   * @param opts - Search options
   */
  search(embed: NamedRef, query: unknown, opts?: FxSearchOptions): Promise<unknown[]>;
  /**
   * Run a bounded AI agent (records `ask`).
   *
   * @param agent - Agent name or handle
   * @param input - Agent input (`{ message }` or string)
   */
  run(agent: NamedRef, input?: unknown): Promise<unknown>;
  /**
   * Stream model tokens (records `ask`). Returns an async iterable of chunks.
   *
   * @param model - Model name or handle
   * @param opts - Prompt / data
   */
  stream(
    model: NamedRef,
    opts?: { readonly prompt?: string; readonly data?: unknown },
  ): AsyncIterable<string>;
  /** Logger. */
  readonly log: FxLog;
  /**
   * Localized ICU message from registered `defineLocale` catalogs.
   * Falls back through the active locale → `i18n.default` → the key.
   *
   * Augment `Register` (`declare module "okengine"`) with `messages` for
   * key autocomplete and compile-time typos.
   *
   * @param key - Dot-separated message key
   * @param values - ICU values (interpolation, plurals, select, rich tags)
   */
  t(key: AppMessageKey, values?: MessageValues): string;
  /** Active locale for {@link Fx.t} and default channel sends. */
  readonly locale: string;
  /** Generate a unique id (UUID). */
  id(): string;
  /** User-plane auth principal. */
  readonly auth: FxAuth;
  /** Operator-plane principal. */
  readonly operator: FxOperator;
  /**
   * Read-only originating identity (audit / attribution).
   * On HTTP entry, tracks the resolved principal; across {@link Fx.call},
   * propagates explicitly — never copied into {@link Fx.auth}.
   */
  readonly principal: FxPrincipal;
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
  /** JSON response helpers (status + Stripe-style envelope). */
  readonly json: FxJson;
  /**
   * Named durable step — never re-runs on journal replay.
   *
   * @param name - Step name
   * @param fn - Step body
   */
  step<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
  /**
   * Ambient abort signal for the current structured-concurrency branch.
   * Outside `all` / `race`, a never-aborted signal.
   */
  readonly signal: AbortSignal;
  /**
   * Run thunks in parallel. On first rejection, abort sibling branches and
   * rethrow. Pass thunks (not started Promises) so abort scopes exist first.
   *
   * @param thunks - Parallel work units
   */
  all<const T extends readonly unknown[]>(thunks: {
    readonly [K in keyof T]: FxThunk<T[K]>;
  }): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }>;
  /**
   * Race thunks. The first settle wins; losers are aborted.
   *
   * @param thunks - Competing work units
   */
  race<T>(thunks: ReadonlyArray<FxThunk<T>>): Promise<T>;
  /**
   * Retry a thunk with exponential backoff and optional full jitter.
   * Prefer wrapping inside {@link Fx.step} so durable replay skips completed work.
   *
   * @param fn - Operation
   * @param opts - Retry policy
   */
  retry<T>(fn: FxThunk<T>, opts?: FxRetryOptions): Promise<T>;
  /**
   * Scope a resource to `use` — `release` runs exactly once when `use`
   * settles or the ambient abort signal fires (e.g. a sibling `fx.race`
   * winner). Same-attempt cleanup; not journaled.
   *
   * @param acquire - Open the resource
   * @param release - Cleanup, always run
   * @param use - Work with the resource
   */
  using<A, T>(
    acquire: () => A | Promise<A>,
    release: (resource: A) => void | Promise<void>,
    use: (resource: A) => T | Promise<T>,
  ): Promise<T>;
}

/**
 * Dispatch target for {@link Fx.call}. Wired by the app so untriggered
 * flows execute through the same pipeline as triggered ones.
 */
export type FxCallHandler = (name: string, input: unknown) => Promise<unknown>;

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
  /**
   * Frozen originating principal (e.g. propagated across {@link Fx.call}).
   * When omitted, {@link Fx.principal} tracks live {@link Fx.auth} / {@link Fx.operator}.
   */
  readonly principal?: FxPrincipal;
  /** Tenant. */
  readonly tenant?: FxTenant;
  /** Secret name → value map for `fx.vault`. */
  readonly secrets?: Readonly<Record<string, string>>;
  /** Seed data for in-memory stores: ref → key → value. */
  readonly storeData?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
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
  /**
   * Optional signal runtime. When set, `fx.emit` enrols through the
   * configured driver (postgres = same transaction as store writes).
   */
  readonly signalRuntime?: SignalRuntime;
  /**
   * Optional vault runtime. When set, `fx.vault` reads through it and
   * `fx.log` redacts loaded secret values automatically.
   */
  readonly vaultRuntime?: VaultRuntime;
  /**
   * Optional channel runtime. When set, `fx.send` delivers through it
   * (templates, consent, fallback chains, receipts).
   */
  readonly channelRuntime?: ChannelRuntime;
  /**
   * Optional AI runtime. When set, `fx.ask` routes through it.
   * Nondeterministic ⇒ journaling forced; auto-cache disabled.
   */
  readonly aiRuntime?: AiRuntime;
  /**
   * Optional run telemetry collector. When set, `fx.cache` and `fx.log`
   * accumulate dimensions / log lines for the wide-event runs store
   * with zero flow instrumentation.
   */
  readonly runTelemetry?: RunTelemetry;
  /** Reveal PII through the store runtime (requires `pii:reveal` upstream). */
  readonly revealPii?: boolean;
  /**
   * Active journal session when the flow is durable. Every `fx` call is
   * recorded; `step` / `sleep` replay from the journal on resume.
   */
  readonly journal?: JournalSession;
  /** When true (or when `journal` is set), journal every fx call. */
  readonly durable?: boolean;
  /**
   * i18n for {@link Fx.t}. When omitted, `fx.t` returns the key
   * (optionally with a JSON params suffix) — same as an empty catalog.
   */
  readonly i18n?: {
    readonly locale?: string;
    readonly defaultLocale?: string;
    readonly catalogs?: MessageCatalogs;
  };
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
  const capability = options.capability ?? createCapabilityToken(options.flow, options.effects);
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
  const defaultLocale = options.i18n?.defaultLocale ?? "en";
  const locale = options.i18n?.locale ?? defaultLocale;
  const catalogs = options.i18n?.catalogs ?? {};
  const principal: FxPrincipal =
    options.principal ??
    ({
      get userId() {
        return auth.userId;
      },
      get operatorId() {
        return operator.id;
      },
      get scopes() {
        return auth.scopes;
      },
      get verified() {
        return auth.verified;
      },
      get plane() {
        if (operator.id) return "operator" as const;
        if (auth.userId) return "user" as const;
        return undefined;
      },
    } satisfies FxPrincipal);
  const journal = options.journal;

  async function gated<T>(
    kind: Parameters<CapabilityToken["assert"]>[0],
    resource: string,
    body: () => T | Promise<T>,
  ): Promise<T> {
    capability.assert(kind, resource);
    const execute = () => recordEffect(ledger, kind, resource, now, body);
    if (journal) {
      return journal.effect(kind, resource, execute);
    }
    return execute();
  }

  function stubStoreHandle(ref: ResourceRef): FxStubStoreHandle {
    const table = (): Map<string, unknown> => {
      let m = stores.get(ref);
      if (!m) {
        m = new Map();
        stores.set(ref, m);
      }
      // Snapshot before any dry-run touch so writes can be rolled back.
      touchDryRunStore(ref, m);
      return m;
    };

    return {
      ref,
      get(key: string): Promise<unknown> {
        return gated("read", ref, () => {
          const v = table().get(key);
          if (v === undefined || v === null) return null;
          // Clone during dry-run so in-place mutation cannot leak past rollback.
          return isDryRun() ? structuredClone(v) : v;
        });
      },
      set(key: string, value: unknown): Promise<void> {
        return gated("write", ref, () => {
          table().set(key, value);
        });
      },
      select(): Promise<unknown[]> {
        return gated("read", ref, () => {
          const values = [...table().values()];
          return isDryRun() ? values.map((v) => structuredClone(v)) : values;
        });
      },
      insert(row: Record<string, unknown>): Promise<{ id: string }> {
        return gated("write", ref, () => {
          const id = typeof row.id === "string" ? row.id : crypto.randomUUID();
          table().set(id, { ...row, id });
          return { id };
        });
      },
      delete(key: string): Promise<boolean> {
        return gated("write", ref, () => table().delete(key));
      },
      /** Audit-plugin convenience (no-op on the stub). */
      async log(_ctx?: unknown): Promise<void> {
        /* stub */
      },
      /** Audit-plugin CLI convenience. */
      async exportCsv(): Promise<string> {
        return "";
      },
    };
  }

  /**
   * Lazy, capability-gated proxy over a driver-backed {@link SqlStoreHandle}.
   *
   * @param decl - Store declaration
   * @param open - Opens (and caches) the runtime handle
   */
  function gatedSqlHandle(decl: StoreDecl, open: () => Promise<SqlStoreHandle>): SqlStoreHandle {
    const ref = decl.ref as `sql:${string}`;
    let cached: SqlStoreHandle | undefined;
    const ensure = async (): Promise<SqlStoreHandle> => {
      if (!cached) cached = await open();
      return cached;
    };
    /** Driver-backed SQL has no dry-run transaction — refuse writes. */
    const refuseDryRunWrite = (): void => {
      if (isDryRun()) {
        throw new DryRunWriteIsolationError(
          `Driver-backed store "${ref}" cannot isolate writes during dry-run; dry-run refused rather than risk a double-write.`,
        );
      }
    };

    return {
      ref,
      get routedRole() {
        return cached?.routedRole ?? "primary";
      },
      get driverId() {
        return cached?.driverId ?? "memory";
      },
      select(columns?) {
        return {
          from(table) {
            const run = (plan: {
              where?: unknown;
              orders?: readonly unknown[];
              limit?: number;
              offset?: number;
            }): Promise<SqlRow[]> =>
              gated("read", ref, async () => {
                const h = await ensure();
                const from = h.select(columns).from(table);
                const filtered = plan.where === undefined ? from : from.where(plan.where);
                const ordered =
                  plan.orders === undefined ? filtered : filtered.orderBy(...plan.orders);
                if (plan.offset !== undefined) return ordered.offset(plan.offset);
                return plan.limit === undefined ? ordered : ordered.limit(plan.limit);
              });

            const tail = (plan: {
              where?: unknown;
              orders?: readonly unknown[];
            }): SelectOrderBuilder => ({
              limit(n) {
                return run({ ...plan, limit: n });
              },
              offset(n) {
                return run({ ...plan, offset: n });
              },
              then(onfulfilled, onrejected) {
                return run(plan).then(onfulfilled, onrejected);
              },
            });

            return {
              where(where) {
                return {
                  ...tail({ where }),
                  orderBy: (...orders: readonly unknown[]) => tail({ where, orders }),
                };
              },
              orderBy: (...orders: readonly unknown[]) => tail({ orders }),
              limit(n: number) {
                return run({ limit: n });
              },
              offset(n: number) {
                return run({ offset: n });
              },
              then(onfulfilled, onrejected) {
                return run({}).then(onfulfilled, onrejected);
              },
            };
          },
        };
      },
      insert(table) {
        return {
          values(row) {
            const runExecute = () =>
              gated("write", ref, async () => {
                refuseDryRunWrite();
                const h = await ensure();
                await h.insert(table).values(row).execute();
              });
            return {
              returning() {
                return gated("write", ref, async () => {
                  refuseDryRunWrite();
                  const h = await ensure();
                  return h.insert(table).values(row).returning();
                });
              },
              execute: runExecute,
              then(onfulfilled, onrejected) {
                return runExecute().then(onfulfilled, onrejected);
              },
            };
          },
        };
      },
      update(table) {
        return {
          set(row) {
            return {
              where(where) {
                return gated("write", ref, async () => {
                  refuseDryRunWrite();
                  const h = await ensure();
                  return h.update(table).set(row).where(where);
                });
              },
            };
          },
        };
      },
      findById(table, id) {
        return gated("read", ref, async () => {
          const h = await ensure();
          return h.findById(table, id);
        });
      },
      delete(table: Parameters<SqlStoreHandle["delete"]>[0], id?: string) {
        if (id !== undefined) {
          return gated("write", ref, async () => {
            refuseDryRunWrite();
            const h = await ensure();
            return h.delete(table, id);
          });
        }
        return {
          where(where: unknown) {
            return gated("write", ref, async () => {
              refuseDryRunWrite();
              const h = await ensure();
              return h.delete(table).where(where);
            });
          },
        };
      },
      exists(table, idOrWhere) {
        return gated("read", ref, async () => {
          const h = await ensure();
          return h.exists(table, idOrWhere);
        });
      },
      upsert(table, matchOn, values, upsertOptions) {
        return gated("write", ref, async () => {
          refuseDryRunWrite();
          const h = await ensure();
          return h.upsert(table, matchOn, values, upsertOptions);
        });
      },
      increment(table, id, column, by) {
        return gated("write", ref, async () => {
          refuseDryRunWrite();
          const h = await ensure();
          return h.increment(table, id, column, by);
        });
      },
      raw(sql, params) {
        return gated("read", ref, async () => {
          const h = await ensure();
          return h.raw(sql, params);
        });
      },
      count(table, where) {
        return gated("read", ref, async () => {
          const h = await ensure();
          return h.count(table, where);
        });
      },
      page(table, pageOptions) {
        return gated("read", ref, async () => {
          const h = await ensure();
          return h.page(table, pageOptions);
        });
      },
      ensureTable(table) {
        return gated("write", ref, async () => {
          refuseDryRunWrite();
          const h = await ensure();
          return h.ensureTable(table);
        });
      },
    } as SqlStoreHandle;
  }

  function storeHandle(ref: SqlStoreDecl): SqlStoreHandle;
  function storeHandle(ref: KvStoreDecl): KvStoreFxHandle;
  function storeHandle(ref: FilesStoreDecl): FilesStoreFxHandle;
  function storeHandle(ref: IndexStoreDecl): IndexStoreFxHandle;
  function storeHandle(ref: NamedRef | { readonly ref: ResourceRef } | StoreDecl): FxStoreHandle;
  function storeHandle(ref: NamedRef | { readonly ref: ResourceRef } | StoreDecl): FxStoreHandle {
    const runtime = options.storeRuntime;
    if (typeof ref === "object" && ref !== null && "facet" in ref) {
      const decl = ref;
      // SQL physics cannot run on the in-memory stub (insert(table).values ≠ stub insert(row)).
      // Without a runtime, fail loudly — never return a stub missing upsert/select/….
      if (!runtime) {
        if (decl.facet === "sql") {
          throw new Error(
            `fx.store("${decl.ref}"): no store runtime — boot the app (stores / flow effects) before using SQL handles`,
          );
        }
        return stubStoreHandle(decl.ref);
      }
      const cache: { handle?: StoreHandle } = {};
      const open = async () => {
        if (!cache.handle) {
          cache.handle = await runtime.open(decl, {
            effects: options.effects ?? {},
            revealPii: options.revealPii,
          });
        }
        return cache.handle;
      };

      if (decl.facet === "sql") {
        return gatedSqlHandle(decl, async () => {
          const h = await open();
          return h as SqlStoreHandle;
        });
      }

      if (decl.facet === "files") {
        const ref = decl.ref;
        return runtime.openFilesFx(
          decl as Extract<StoreDecl, { facet: "files" }>,
          {
            effects: options.effects ?? {},
            revealPii: options.revealPii,
          },
          {
            gate: gated,
            refuseDryRunWrite: () => {
              if (isDryRun()) {
                throw new DryRunWriteIsolationError(
                  `Driver-backed store "${ref}" cannot isolate writes during dry-run; dry-run refused rather than risk a double-write.`,
                );
              }
            },
          },
        );
      }

      // KV / index — thin gated wrappers preserving driver methods.
      const baseRef = decl.ref;
      return new Proxy({} as StoreHandle, {
        get(_t, prop) {
          if (prop === "ref") return baseRef;
          if (prop === "then") return undefined;
          const isRead = prop === "get" || prop === "search" || prop === "list";
          return (...args: unknown[]) =>
            gated(isRead ? "read" : "write", baseRef, async () => {
              if (!isRead && isDryRun()) {
                throw new DryRunWriteIsolationError(
                  `Driver-backed store "${baseRef}" cannot isolate writes during dry-run; dry-run refused rather than risk a double-write.`,
                );
              }
              const h = await open();
              const fn = (h as unknown as Record<string | symbol, unknown>)[prop];
              if (typeof fn !== "function") return undefined;
              return (fn as (...a: unknown[]) => unknown).apply(h, args);
            });
        },
      });
    }
    return stubStoreHandle(resolveStoreRef(ref as NamedRef | { readonly ref: ResourceRef }));
  }

  const clock: FxClock = {
    now,
    async sleep(label: string, duration: string): Promise<void> {
      if (journal) {
        await journal.sleep(label, duration, parseDurationMs);
        return;
      }
      /* non-durable: resolve immediately (tests / sync flows) */
      void label;
      void duration;
    },
  };

  const aiDisablesCache = options.aiRuntime?.autoCacheDisabled === true;
  const telemetry = options.runTelemetry;

  const cache: FxCache = {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      if (aiDisablesCache) return undefined;
      if (cacheStore.has(key)) {
        if (telemetry) telemetry.cacheHits += 1;
        return cacheStore.get(key) as T | undefined;
      }
      if (telemetry) telemetry.cacheMisses += 1;
      return undefined;
    },
    async set(key: string, value: unknown, _ttl?: string): Promise<void> {
      if (aiDisablesCache) return;
      cacheStore.set(key, value);
    },
    async getOrSet<T>(key: string, _ttl: string, produce: () => T | Promise<T>): Promise<T> {
      if (aiDisablesCache) return await produce();
      if (cacheStore.has(key)) {
        if (telemetry) telemetry.cacheHits += 1;
        return cacheStore.get(key) as T;
      }
      if (telemetry) telemetry.cacheMisses += 1;
      const value = await produce();
      cacheStore.set(key, value);
      return value;
    },
  };

  function redactLog(
    message: string,
    data?: Record<string, unknown>,
  ): { message: string; data?: Record<string, unknown> } {
    const vault = options.vaultRuntime;
    // Redacted<T> never yields the real value, but replace instances with a
    // placeholder so payloads stay plain JSON (and never re-wrap on replay).
    const maskedData = data ? maskRedactedDeep(data) : undefined;
    if (!vault) return { message, data: maskedData };
    const safeMessage = vault.redactString(message);
    const safeData = maskedData ? (vault.redact(maskedData) as Record<string, unknown>) : undefined;
    return { message: safeMessage, data: safeData };
  }

  function emitLog(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const r = redactLog(message, data);
    if (telemetry) {
      telemetry.logs.push({
        level,
        message: r.message,
        ...(r.data !== undefined ? { data: r.data } : {}),
        at: now(),
      });
    }
    onLog?.(level, r.message, r.data);
  }

  const log: FxLog = {
    debug(message, data) {
      emitLog("debug", message, data);
    },
    info(message, data) {
      emitLog("info", message, data);
    },
    warn(message, data) {
      emitLog("warn", message, data);
    },
    error(message, data) {
      emitLog("error", message, data);
    },
  };

  const fx: Fx = {
    store: storeHandle,
    emit(signal, payload, emitOptions) {
      const name = resolveName(signal);
      return gated("emit", name, async () => {
        if (options.signalRuntime) {
          await options.signalRuntime.emit(name, payload, emitOptions);
        }
      });
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
      const value = options.vaultRuntime
        ? options.vaultRuntime.read(name)
        : (secrets[name] ?? `[secret:${name}]`);
      ledger.record({
        kind: "secret",
        resource: name,
        timestamp,
        duration: Math.max(0, now() - timestamp),
        reversibility: reversibilityOf("secret"),
      });
      return new Redacted(value);
    },
    cache,
    send(template, opts) {
      const name = resolveName(template);
      return gated("send", name, async () => {
        // Dry-run: record "would have fired" — never contact a real channel
        // (console §9.1 · §9.3 · §9.4).
        if (isDryRun()) {
          recordWouldHaveFired("send", name);
          return { ok: true as const };
        }
        if (options.channelRuntime) {
          const result = await options.channelRuntime.send(name, {
            to: opts?.to ?? "",
            data: opts?.data,
            via: opts?.via?.map(resolveName),
            locale: opts?.locale ?? locale,
            profileLocale: opts?.profileLocale,
            acceptLanguage: opts?.acceptLanguage,
          });
          return { ok: result.ok as true };
        }
        return { ok: true as const };
      });
    },
    ask(prompt, input, opts) {
      const name = resolveName(prompt);
      return gated("ask", name, async () => {
        // Dry-run: stub the model call the same way as send.
        if (isDryRun()) {
          recordWouldHaveFired("ask", name);
          return {};
        }
        if (options.aiRuntime) {
          return options.aiRuntime.ask(name, input, {
            via: opts?.via?.map(resolveName),
            tools: opts?.tools?.map(resolveName),
            maxSteps: opts?.maxSteps,
            // Host fx.call — same capability / ledger / Runs path as any call.
            callTool: (tool, toolInput) => fx.call(tool, toolInput),
          });
        }
        return {};
      });
    },
    search(embed, query, opts) {
      const name = resolveName(embed);
      return gated("read", name, async () => {
        if (options.aiRuntime && "search" in options.aiRuntime) {
          const searchFn = (
            options.aiRuntime as {
              search?: (
                embed: string,
                query: unknown,
                opts?: FxSearchOptions,
              ) => Promise<unknown[]>;
            }
          ).search;
          if (typeof searchFn === "function") {
            return searchFn(name, query, opts);
          }
        }
        // Deterministic stub for tests without an index driver.
        if (typeof query === "string" && query.length > 0) {
          return [{ id: "stub", score: 1, text: query, topK: opts?.topK ?? 5 }];
        }
        return [];
      });
    },
    run(agent, input) {
      const name = resolveName(agent);
      return gated("ask", name, async () => {
        if (options.aiRuntime) {
          const message =
            typeof input === "string"
              ? input
              : input && typeof input === "object" && "message" in input
                ? String((input as { message: unknown }).message)
                : JSON.stringify(input ?? {});
          return options.aiRuntime.runAgent(name, {
            message,
            auth: {
              userId: auth.userId,
              scopes: auth.scopes,
              verified: auth.verified,
            },
            callTool: (tool, toolInput) => fx.call(tool, toolInput),
          });
        }
        return { ok: true, steps: 0, denials: [], output: input };
      });
    },
    stream(model, opts) {
      const name = resolveName(model);
      const chunks = (async function* () {
        await gated("ask", name, async () => undefined);
        if (isDryRun()) {
          recordWouldHaveFired("ask", name);
          return;
        }
        if (!options.aiRuntime) {
          throw new Error(`fx.stream: AI runtime is not configured for model "${name}"`);
        }
        // One cancellation channel: ambient ALS signal (Prompt 57) + local
        // controller aborted when the consumer stops iterating.
        const ambient = currentAbortSignal();
        const local = new AbortController();
        const unlink = linkAbort(ambient, local);
        try {
          for await (const text of options.aiRuntime.stream(name, {
            prompt: opts?.prompt,
            data: opts?.data,
            signal: local.signal,
          })) {
            if (local.signal.aborted) break;
            yield text;
          }
        } finally {
          unlink();
          if (!local.signal.aborted) local.abort();
        }
      })();
      return chunks;
    },
    log,
    t(key, values) {
      return translate({
        locale,
        defaultLocale,
        catalogs,
        key,
        values,
      });
    },
    locale,
    id() {
      return crypto.randomUUID();
    },
    auth,
    operator,
    principal,
    tenant,
    fail,
    json: {
      ok<T>(value: T, opts?: { readonly meta?: Record<string, unknown> }): JsonResult<T> {
        return {
          [jsonResultBrand]: true,
          status: 200,
          value,
          ...(opts?.meta !== undefined ? { meta: opts.meta } : {}),
        } as JsonResult<T>;
      },
      create<T>(value: T): JsonResult<T> {
        return { [jsonResultBrand]: true, status: 201, value } as JsonResult<T>;
      },
      empty(): JsonResult<never> {
        return { [jsonResultBrand]: true, status: 204 } as JsonResult<never>;
      },
      with<T>(data: T, meta: Record<string, unknown>): JsonResult<T> {
        return { [jsonResultBrand]: true, status: 200, value: data, meta } as JsonResult<T>;
      },
    },
    async step<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
      if (journal) {
        return journal.step(name, fn);
      }
      return await fn();
    },
    get signal(): AbortSignal {
      return currentAbortSignal();
    },
    all(thunks) {
      return fxAll(thunks);
    },
    race(thunks) {
      return fxRace(thunks);
    },
    retry(fn, opts) {
      return fxRetry(fn, opts);
    },
    using(acquire, release, use) {
      return fxUsing(acquire, release, use);
    },
  };

  return { fx, ledger, capability };
}
