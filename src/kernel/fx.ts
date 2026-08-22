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

import type { Effects, ResourceRef, SignalResourceRef } from "../manifest/types.ts";
import { isMcpToolRef } from "../manifest/mcp-ref.ts";
import type { QueryPageSpec } from "./list-page.ts";
import { schemaTableName, sqlTableRef } from "../manifest/sql-resource.ts";
import type {
  FilesStoreDecl,
  FilesStoreFxHandle,
  IndexStoreDecl,
  IndexStoreFxHandle,
  KvStoreDecl,
  KvStoreFxHandle,
  SelectFromBuilder,
  SelectOrderBuilder,
  SqlStoreDecl,
  StoreDecl,
  StoreHandle,
  StoreRuntime,
  SqlStoreHandle,
} from "../elements/store.ts";
import { rlsIdentityFromAuth } from "../elements/store.ts";
import type { RlsIdentity } from "../drivers/pg-rls.ts";
import type { SqlRow } from "../drivers/types.ts";
import type { SignalDecl, SignalRuntime } from "../elements/signal.ts";
import type { DeadLetter, SignalEmitOptions } from "../drivers/signal-types.ts";
import type { VaultActor, VaultAdapter, VaultRuntime } from "../elements/vault.ts";
import type { ChannelRuntime } from "../elements/channel.ts";
import type { AiRuntime } from "../elements/ai.ts";
import { parseDurationMs } from "../elements/clock/duration.ts";
import type { ApiKeyStore } from "../auth/api-keys.ts";
import type { FxAuthIdentity, FxAuthKeyMethods } from "./fx-auth-keys.ts";
import type { FxAuthTenantMethods } from "./fx-auth-tenants.ts";
import type { TenantStore } from "../auth/tenants.ts";
import type { SessionCrypto, SessionStore } from "../auth/sessions.ts";
import type { Manifest } from "../manifest/types.ts";
import { createCapabilityToken, type CapabilityToken } from "./capability.ts";
import { createEffectLedger, recordEffect, reversibilityOf, type EffectLedger } from "./effects.ts";
import { resolveDurationMs } from "./elapsed.ts";
import {
  DryRunWriteIsolationError,
  isDryRun,
  recordWouldHaveFired,
  touchDryRunStore,
} from "./dry-run.ts";
import { fail, throwOke, type FailOptions, type FlowFailure } from "./errors.ts";
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
import type { JournalSession, JournalStepOptions } from "./journal.ts";

/** Options for {@link Fx.step} — see {@link JournalStepOptions}. */
export type StepOptions<T> = JournalStepOptions<T>;
import type { RunTelemetry } from "./run-telemetry.ts";
import type { RunsRuntime } from "../runs/runtime.ts";
import type { RunsRow, WideEvent } from "../runs/types.ts";
import type { RunWindowStats, SloBreach } from "../runs/window.ts";
import type { MessageCatalogs } from "../i18n/messages.ts";
import { lazyRequire } from "./lazy-require.ts";
import type { AppMessageKey, MessageValues } from "../i18n/types.ts";

/** Lazy runs/window helpers — kept off the cold `oke` static graph. */
async function loadRunsWindow(): Promise<typeof import("../runs/window.ts")> {
  return import("../runs/window.ts");
}

/**
 * Sync-load live SSE + Last-Event-ID resume only when `fx.live` runs.
 * A static import would pin `checkLiveResume` / 410 encoding on every
 * createFx — including Store-only `oke()` graphs.
 */
function loadFxLiveStream(): typeof import("./fx-live-stream.ts") {
  return lazyRequire(import.meta.dir, ["fx", "live", "stream"].join("-"));
}

/** Resource ref Flows declare to read the Runs store via {@link Fx.runs}. */
export const RUNS_RESOURCE = "runs";

/**
 * Resource ref Flows declare for {@link Fx.auth} key management.
 * Same string as `src/auth/api-keys.ts` — defined here so the HMAC / key-store
 * module stays off the edge and Store-only graphs.
 */
export const AUTH_API_KEYS_RESOURCE = "auth:api-keys";

/**
 * Resource ref Flows declare for {@link Fx.auth} tenant methods.
 * Same string as `src/auth/tenants.ts`.
 */
export const AUTH_TENANTS_RESOURCE = "auth:tenants";

/**
 * Capability ref for {@link Fx.deadLetters} / {@link Fx.live} — `signal:<name>`, never a store facet.
 *
 * @param name - Signal name
 */
export function signalReadRef(name: string): SignalResourceRef {
  return `signal:${name}`;
}

export type { FxRetryOptions, FxThunk } from "./concurrency.ts";

/** Named ref: plain string or `{ name }` element handle (optional pin). */
export type NamedRef = string | { readonly name: string; readonly version?: number };

/** Resolve a {@link NamedRef} to its string id (`name@version` when pinned). */
export function resolveName(ref: NamedRef): string {
  if (typeof ref === "string") return ref;
  return ref.version !== undefined ? `${ref.name}@${ref.version}` : ref.name;
}

/** Resolve a store argument to a `facet:name` resource ref. */
export function resolveStoreRef(ref: NamedRef | { readonly ref: ResourceRef }): ResourceRef {
  if (typeof ref === "string") return ref as ResourceRef;
  if ("ref" in ref) return ref.ref;
  return ref.name as ResourceRef;
}

export type { FxAuthIdentity } from "./fx-auth-keys.ts";

/** Auth principal on the user plane. */
export interface FxAuth extends FxAuthIdentity, FxAuthKeyMethods, FxAuthTenantMethods {}

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
   * Instant `duration` before {@link FxClock.now} (`"30d"` → now − 30 days).
   * Uses the same duration strings as {@link FxClock.sleep} / `every()`.
   *
   * @param duration - Duration string (e.g. `"30d"`, `"2h"`)
   */
  ago(duration: string): number;
  /**
   * Instant `duration` after {@link FxClock.now} (`"14d"` → now + 14 days).
   * Uses the same duration strings as {@link FxClock.sleep} / `every()`.
   *
   * @param duration - Duration string (e.g. `"14d"`, `"15m"`)
   */
  fromNow(duration: string): number;
  /**
   * Span in milliseconds (`"30d"` → `2_592_000_000`). Compose with a stored
   * instant: `createdAt + fx.clock.duration("7d")`. Unknown strings are `0`.
   *
   * @param duration - Duration string (e.g. `"30d"`, `"200ms"`)
   */
  duration(duration: string): number;
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

/** Options for {@link Fx.sendOtp} (provider-managed SMS OTP). */
export interface FxSendOtpOptions {
  /** Recipient phone number (E.164). */
  readonly to: string;
  /** Unique id for this verification flow (required again on verify). */
  readonly requestId: string;
  /** Message language (`en` or `ar`). */
  readonly lang?: "en" | "ar";
  /** Optional note appended to the OTP SMS. */
  readonly note?: string;
  /** Sender id override. */
  readonly from?: string;
}

/** Options for {@link Fx.verifyOtp}. */
export interface FxVerifyOtpOptions {
  /** Recipient phone number (same as send). */
  readonly to: string;
  /** Same {@link FxSendOtpOptions.requestId} used when sending. */
  readonly requestId: string;
  /** OTP code the user entered. */
  readonly code: string;
  /** Message language (`en` or `ar`). */
  readonly lang?: "en" | "ar";
  /** Sender id override. */
  readonly from?: string;
  /** Optional note. */
  readonly note?: string;
}

/** Options for {@link Fx.deliverOtp} (Tier-2 multi-channel delivery). */
export interface FxDeliverOtpOptions {
  /** Preferred channel order. */
  readonly channels: readonly ("sms" | "whatsapp" | "email")[];
  /** Template name per medium. */
  readonly templates: Readonly<Partial<Record<"sms" | "whatsapp" | "email", string>>>;
  readonly email?: string;
  readonly phone?: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly locale?: string;
  /** Explicit single-channel resend — no cross-medium failover. */
  readonly only?: "sms" | "whatsapp" | "email";
}

/** Options for {@link Fx.ask}. */
export interface FxAskOptions {
  readonly via?: readonly NamedRef[];
  /** Per-call deadline — overrides prompt `timeout` (`"30s"` or ms). */
  readonly timeout?: string | number;
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
  readonly kind?: undefined;
}

/** SSE carrier from {@link FxJson.stream} / {@link Fx.live}. */
export interface JsonStreamResult {
  readonly [jsonResultBrand]: true;
  readonly kind: "stream";
  readonly status: 200;
  readonly chunks: AsyncIterable<unknown>;
  /** Awaited before the 200 SSE body; throws OKE1014 on a missing resume cursor. */
  ready?: () => Promise<void>;
  /** Set by the kernel to commit journal / Runs after the stream settles. */
  finalize?: () => Promise<void>;
}

const sseFrameBrand: unique symbol = Symbol.for("oke.sse.frame");

/** One SSE frame — optional `id:` plus JSON `data:`. */
export interface SseFrame {
  readonly [sseFrameBrand]: true;
  readonly data: unknown;
  readonly id?: string;
}

/**
 * Brand a stream chunk so {@link encodeSseStream} can emit `id:`.
 *
 * @param data - JSON payload
 * @param id - Optional SSE id
 */
export function sseFrame(data: unknown, id?: string): SseFrame {
  return id !== undefined ? { [sseFrameBrand]: true, data, id } : { [sseFrameBrand]: true, data };
}

/**
 * True when `value` is a branded SSE frame.
 *
 * @param value - Unknown
 */
export function isSseFrame(value: unknown): value is SseFrame {
  return typeof value === "object" && value !== null && (value as SseFrame)[sseFrameBrand] === true;
}

/** True when `value` is an {@link FxJson} JSON-envelope carrier. */
export function isJsonResult(value: unknown): value is JsonResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as JsonResult)[jsonResultBrand] === true &&
    (value as JsonStreamResult).kind !== "stream"
  );
}

/** True when `value` is an SSE stream carrier from {@link FxJson.stream}. */
export function isJsonStreamResult(value: unknown): value is JsonStreamResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as JsonStreamResult)[jsonResultBrand] === true &&
    (value as JsonStreamResult).kind === "stream"
  );
}

/**
 * Paginated JSON page — `data` is Flow `out`; `meta` is the HTTP pager.
 *
 * Pass this to {@link FxJson.with} instead of splitting the fields.
 */
export type JsonPage<T> = {
  readonly data: T;
  readonly meta: Record<string, unknown>;
};

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
  /** 200 — body `{ data, meta, error: null }` from a {@link JsonPage}. */
  with<T>(page: JsonPage<T>): JsonResult<T>;
  /** 200 — body `{ data, meta, error: null }` (paginated lists). */
  with<T>(data: T, meta: Record<string, unknown>): JsonResult<T>;
  /**
   * 200 — page an in-memory list from `input`. Zero-config: `q` searches
   * every string field; extra keys auto-eq except `id`.
   */
  withQuery<T>(rows: readonly T[], input: unknown, spec?: QueryPageSpec<T>): JsonResult<T[]>;
  /**
   * 200 — `text/event-stream` of JSON `data:` frames, then `data: [DONE]`.
   * Pass {@link Fx.stream} or any async iterable of chunks.
   */
  stream(chunks: AsyncIterable<unknown>): JsonStreamResult;
}

/**
 * Build a branded 200 result with required `meta`.
 *
 * @param dataOrPage - Item array, or `{ data, meta }`
 * @param meta - Pager when using the two-arg form
 */
function jsonWith<T>(dataOrPage: T | JsonPage<T>, meta?: Record<string, unknown>): JsonResult<T> {
  if (meta !== undefined) {
    return { [jsonResultBrand]: true, status: 200, value: dataOrPage as T, meta } as JsonResult<T>;
  }
  if (
    typeof dataOrPage !== "object" ||
    dataOrPage === null ||
    !("data" in dataOrPage) ||
    !("meta" in dataOrPage)
  ) {
    throw new TypeError("fx.json.with: pass (data, meta) or ({ data, meta })");
  }
  const page = dataOrPage as JsonPage<T>;
  return {
    [jsonResultBrand]: true,
    status: 200,
    value: page.data,
    meta: page.meta,
  } as JsonResult<T>;
}

/**
 * Sync-load the PostgREST list grammar only when `fx.json.withQuery` runs.
 * A static import would pin ~4 kB gzip on every `createFx` — including the
 * edge profile and Store-only `oke()` graphs that never page a list.
 */
function loadListPage(): typeof import("./list-page.ts") {
  return lazyRequire(import.meta.dir, ["list", "page"].join("-"));
}

/**
 * Sync-load i18n catalogs only when `fx.t` runs.
 */
function loadMessages(): typeof import("../i18n/messages.ts") {
  return lazyRequire(`${import.meta.dir}/../i18n`, ["mes", "sages"].join(""));
}

/**
 * Page rows from a list query and wrap them as {@link FxJson.with}.
 *
 * @param rows - Already-loaded items
 * @param input - List query / path fields
 * @param spec - Optional mode, keyset, or column lock
 */
function jsonWithQuery<T>(
  rows: readonly T[],
  input: unknown,
  spec?: QueryPageSpec<T>,
): JsonResult<T[]> {
  return jsonWith(loadListPage().listPage(rows, input, spec));
}

/** Options for {@link FxVault.set}. */
export interface FxVaultSetOptions {
  /** Relative expiry from now, in milliseconds. */
  readonly ttlMs?: number;
  /** Non-sensitive metadata stored beside the ciphertext. */
  readonly metadata?: Record<string, unknown>;
}

/** Identity of a written secret version. */
export interface FxVaultWriteResult {
  /** Canonical path that was written. */
  readonly path: string;
  /** Monotonic version of the new value. */
  readonly version: number;
}

/** Operational state of the bound Vault backend. */
export interface FxVaultStatus {
  /** Whether the master key is currently unavailable. */
  readonly sealed: boolean;
  /** Whether the backend has been initialized. */
  readonly initialized: boolean;
  /** Backend id (`sql`, `memory`, `vault`, …). */
  readonly backend: string;
}

/**
 * Vault surface on `fx`.
 *
 * `get` reads through the boot-time resolution chain and is the only method
 * every app has: the mutation and introspection methods need a bound
 * {@link CreateFxOptions.vaultAdapter} (the encrypted-at-rest backend) and
 * throw without one.
 */
export interface FxVault {
  /**
   * Read a vault secret (records `secret`).
   *
   * Returns a {@link Redacted} — printing / logging / serializing it yields a
   * placeholder, never the value. Call `.reveal()` at the one boundary that
   * needs the real value (e.g. passing a credential to a driver).
   *
   * @param secret - Secret name or handle
   */
  get(secret: NamedRef): Promise<Redacted<string>>;
  /**
   * Write a new version of a path (records `secret`).
   *
   * @param path - Secret path or handle
   * @param value - Cleartext value
   * @param options - TTL / metadata
   */
  set(path: NamedRef, value: string, options?: FxVaultSetOptions): Promise<FxVaultWriteResult>;
  /**
   * Write a new version with a fresh data key, retiring the previous one
   * (records `secret`).
   *
   * @param path - Secret path or handle
   * @param value - New cleartext value
   */
  rotate(path: NamedRef, value: string): Promise<FxVaultWriteResult>;
  /**
   * Crypto-shred a path (records `secret`). Returns whether anything went.
   *
   * @param path - Secret path or handle
   */
  delete(path: NamedRef): Promise<boolean>;
  /**
   * Enumerate secret paths (never values).
   *
   * @param prefix - Canonical path prefix filter
   */
  list(prefix?: string): Promise<readonly string[]>;
  /** Seal / initialization state of the backend. */
  status(): Promise<FxVaultStatus>;
}

/**
 * Flow-facing read door to the Runs wide-event store.
 *
 * Declare `effects: { reads: ["runs"] }`. Powers native SLO checkers
 * (Clock + Channel) without a parallel `fx.metric` API.
 */
export interface FxRuns {
  /**
   * Run SQL against the Runs store (`FROM runs` for files/memory).
   *
   * @param sql - Driver SQL
   */
  query(sql: string): Promise<RunsRow[]>;
  /** Materialise all visible wide events (small stores / tests). */
  all(): Promise<WideEvent[]>;
  /**
   * Rolling P95 / success-rate stats for one flow over a window.
   *
   * @param flow - Flow name
   * @param windowMs - Lookback window (default 5 minutes)
   */
  window(flow: string, windowMs?: number): Promise<RunWindowStats>;
  /**
   * Evaluate Manifest-style SLO thresholds against a rolling window.
   *
   * @param flow - Flow name
   * @param slo - Availability / latency thresholds
   * @param windowMs - Lookback window (default 5 minutes)
   */
  checkSlo(
    flow: string,
    slo: {
      readonly availability?: string;
      readonly latency?: { readonly p95?: string; readonly p99?: string };
    },
    windowMs?: number,
  ): Promise<readonly SloBreach[]>;
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
   * Query dead-lettered messages for one signal (records `read` on `signal:<name>`).
   *
   * Requires a bound signal runtime and `effects.reads` including `signal:<name>`.
   *
   * @param signal - Signal name or handle
   */
  deadLetters<T>(signal: SignalDecl<T>): Promise<readonly DeadLetter<T>[]>;
  deadLetters(signal: NamedRef): Promise<readonly DeadLetter[]>;
  /**
   * Stream a `delivery: "live"` signal as SSE (records `read` on `signal:<name>`).
   *
   * HTTP `Last-Event-ID` is applied when `opts.afterId` is omitted. A missing
   * cursor throws OKE1014; `JsonStreamResult.ready` turns that into HTTP 410.
   *
   * @param signal - Signal name or handle
   * @param opts - Payload filter and optional resume cursor
   */
  live<T>(
    signal: SignalDecl<T>,
    opts?: {
      readonly match?: (payload: T) => boolean;
      readonly afterId?: string;
    },
  ): JsonStreamResult;
  live(
    signal: NamedRef,
    opts?: {
      readonly match?: (payload: unknown) => boolean;
      readonly afterId?: string;
    },
  ): JsonStreamResult;
  /**
   * Call another flow (records `call`). Stub returns `undefined`.
   *
   * @param flow - Flow name or handle
   * @param input - Input payload
   */
  call(flow: NamedRef, input?: unknown): Promise<unknown>;
  /**
   * Query the Runs wide-event store (records `read` on `"runs"`).
   * Requires a bound runs runtime and `effects.reads` including `"runs"`.
   */
  readonly runs: FxRuns;
  /** Clock surface. */
  readonly clock: FxClock;
  /** Vault surface — `fx.vault.get(secret)` and the adapter-backed mutations. */
  readonly vault: FxVault;
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
   * Send a provider-managed SMS OTP (records `send` on `sms-otp`).
   *
   * Vendor extra (Taqnyat Verify API) — requires a bound SMS driver that
   * supports provider-managed OTP. Dry-run records would-have-fired without
   * contacting the provider.
   *
   * @param opts - Recipient + requestId (+ lang / note / from)
   */
  sendOtp(opts: FxSendOtpOptions): Promise<{ ok: true }>;
  /**
   * Verify a provider-managed SMS OTP code (records `send` on `sms-otp`).
   *
   * @param opts - Recipient + requestId + code (+ lang / note / from)
   */
  verifyOtp(opts: FxVerifyOtpOptions): Promise<{ ok: true }>;
  /**
   * Deliver an app-owned OTP across declared channels (records `send` on `auth-otp`).
   *
   * Tier-2 only — uses Channel `deliverOtp` (sently FallbackTransport). Pass
   * `only` for explicit user resend (single channel, no cross-medium failover).
   *
   * @param opts - Channels, templates, addresses, OTP data
   */
  deliverOtp(opts: FxDeliverOtpOptions): Promise<{
    ok: true;
    channel: "sms" | "whatsapp" | "email";
  }>;
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
    opts?: {
      readonly prompt?: string;
      readonly data?: unknown;
      readonly via?: readonly NamedRef[];
    },
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
   * @param opts - Optional `{ undo }` — durable compensation on terminal failure
   */
  step<T>(name: string, fn: () => T | Promise<T>, opts?: StepOptions<T>): Promise<T>;
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
  /** Auth principal bag (key methods attach at create time). */
  readonly auth?: FxAuthIdentity;
  /** Shared API key store for {@link Fx.auth} key methods. */
  readonly apiKeyStore?: ApiKeyStore;
  /** Tenant registry (when `gate.auth.tenant` is on). */
  readonly tenantStore?: TenantStore;
  /** Session store for {@link Fx.auth.switchTenant}. */
  readonly sessions?: SessionStore;
  /** Session crypto for {@link Fx.auth.switchTenant}. */
  readonly sessionCrypto?: SessionCrypto;
  /** Manifest for tenant-role catalog validation. */
  readonly manifest?: Manifest | null;
  /** When true, tenant-scoped KV / vault defaults apply. */
  readonly tenantEnabled?: boolean;
  /**
   * When false, skip tenant-role scope union (tenant-unaware flow).
   * Default true when {@link tenantEnabled}.
   */
  readonly flowTenantScoped?: boolean;
  /** Current flow plane (tenant-role union is user-plane only). */
  readonly flowPlane?: "user" | "operator";
  /** Operator principal. */
  readonly operator?: FxOperator;
  /**
   * Frozen originating principal (e.g. propagated across {@link Fx.call}).
   * When omitted, {@link Fx.principal} tracks live {@link Fx.auth} / {@link Fx.operator}.
   */
  readonly principal?: FxPrincipal;
  /** Tenant. */
  readonly tenant?: FxTenant;
  /** Secret name → value map for `fx.vault.get`. */
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
   * Optional runs runtime. When set, `fx.runs` queries wide events for
   * native SLO checkers (Clock + Channel alerting).
   */
  readonly runsRuntime?: RunsRuntime;
  /**
   * Optional vault runtime. When set, `fx.vault.get` reads through it and
   * `fx.log` redacts loaded secret values automatically.
   */
  readonly vaultRuntime?: VaultRuntime;
  /**
   * Optional encrypted-at-rest Vault backend. Required by the `fx.vault`
   * mutation / introspection methods (`set`, `rotate`, `delete`, `list`,
   * `status`); reads never need it.
   */
  readonly vaultAdapter?: VaultAdapter;
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
  /**
   * This invocation's WideEvent / run id. Stamped onto `fx.emit` messages
   * as `parentRunId` so consuming Flows can join the trace chain.
   */
  readonly runId?: string;
  /** HTTP `Last-Event-ID` for {@link Fx.live} resume (tests may pass `opts.afterId`). */
  readonly lastEventId?: string;
  /** Reveal PII through the store runtime (requires `pii:reveal` upstream). */
  readonly revealPii?: boolean;
  /** Trigger gate names for RLS (`oke.gate` = first policy/public). */
  readonly rlsGateNames?: readonly string[];
  /** Skip RLS stamp (Operator / `bypassGates` / operator-plane flows). */
  readonly rlsBypass?: boolean;
  /** Forced bag (Console / Call API). Wins over {@link rlsGateNames}. */
  readonly rls?: import("../drivers/pg-rls.ts").RlsIdentity;
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
 * Stamp prompt version, cost, and driver-supplied tokens onto run telemetry.
 * Cost and tokens are added only when the journal recorded a value greater
 * than zero — token-only drivers must not invent a $0 WideEvent field.
 *
 * @param telemetry - Per-run collector
 * @param runtime - AI runtime that just ran the ask
 * @param prompt - Resolved prompt name
 */
function stampAskTelemetry(
  telemetry: RunTelemetry | undefined,
  runtime: AiRuntime,
  prompt: string,
): void {
  if (!telemetry) return;
  const last = runtime.journal[runtime.journal.length - 1];
  const fromJournal = last?.prompt === prompt ? last : undefined;
  const version = fromJournal?.version ?? runtime.prompts.get(prompt)?.version;
  if (typeof version === "number") telemetry.promptVersion = version;
  const cost = fromJournal?.cost ?? 0;
  if (cost > 0) telemetry.cost += cost;
  const inputTokens = fromJournal?.inputTokens ?? 0;
  if (inputTokens > 0) telemetry.inputTokens += inputTokens;
  const outputTokens = fromJournal?.outputTokens ?? 0;
  if (outputTokens > 0) telemetry.outputTokens += outputTokens;
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

  // Computed stem — a static import would pin HMAC / api-keys on every createFx.
  const authBag = options.auth ?? { userId: null, scopes: new Set() };
  const keys = lazyRequire<typeof import("./fx-auth-keys.ts")>(
    import.meta.dir,
    ["fx", "auth", "keys"].join("-"),
  ).attach({
    auth: authBag,
    store: options.apiKeyStore,
    now,
    gated,
  });
  const auth: FxAuth =
    options.tenantStore !== undefined || options.tenantEnabled === true
      ? (lazyRequire<typeof import("./fx-auth-tenants.ts")>(
          import.meta.dir,
          ["fx", "auth", "tenants"].join("-"),
        ).attach({
          auth: keys,
          store: options.tenantStore,
          sessions: options.sessions,
          crypto: options.sessionCrypto,
          manifest: options.manifest ?? undefined,
          now,
          gated,
        }) as FxAuth)
      : (keys as FxAuth);
  const operator: FxOperator = options.operator ?? { id: null };
  const tenant: { id: string | null } = options.tenant ?? { id: null };
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

  function rlsInvokeContext(): { rls?: RlsIdentity } {
    if (options.rlsBypass === true) return {};
    if (options.rls) return { rls: options.rls };
    const identity = rlsIdentityFromAuth({
      userId: auth.userId,
      scopes: auth.scopes,
      gateNames: options.rlsGateNames ?? [],
      bypass: false,
      operator: false,
      ...(options.tenantEnabled === true ? { tenantId: tenant.id } : {}),
    });
    return identity ? { rls: identity } : {};
  }

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
    /**
     * Gate a table-scoped SQL operation. Prefers the precise `sql:<table>`
     * ref (matches what the compiler's AST inference derives from the same
     * call site — {@link "../manifest/sql-resource.ts"}); falls back to the
     * store-level ref when the table ref isn't declared — every flow that
     * hand-declared the older `effects: { writes: ["sql:<store>"] }`
     * convention (every existing template, `upsert-app.test.ts`, …) must
     * keep working unchanged. Ledger / journal record whichever ref the
     * capability check actually matched, not always the coarser one.
     *
     * @param kind - Effect kind
     * @param table - Table argument passed to a `SqlStoreHandle` method
     * @param body - Work to run under the gate
     */
    const gatedTable = <T>(
      kind: Parameters<CapabilityToken["assert"]>[0],
      table: unknown,
      body: () => T | Promise<T>,
    ): Promise<T> => {
      const name = schemaTableName(table);
      if (name !== undefined) {
        const perTable = sqlTableRef(name);
        if (perTable !== ref && capability.allows(kind, perTable)) {
          return gated(kind, perTable, body);
        }
      }
      return gated(kind, ref, body);
    };

    return {
      ref,
      get routedRole() {
        return cached?.routedRole ?? "primary";
      },
      get driverId() {
        return cached?.driverId ?? "memory";
      },
      select: ((columns?: unknown) => {
        return {
          from(table: unknown) {
            const run = (plan: {
              where?: unknown;
              orders?: readonly unknown[];
              limit?: number;
              offset?: number;
            }): Promise<SqlRow[]> =>
              gatedTable("read", table, async () => {
                const h = await ensure();
                const from = h.select(columns).from(table) as SelectFromBuilder;
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
              where(where: unknown) {
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
              then(
                onfulfilled: (value: SqlRow[]) => unknown,
                onrejected?: (reason: unknown) => unknown,
              ) {
                return run({}).then(onfulfilled, onrejected);
              },
            };
          },
        };
      }) as SqlStoreHandle["select"],
      insert(table) {
        return {
          values(row) {
            const runExecute = () =>
              gatedTable("write", table, async () => {
                refuseDryRunWrite();
                const h = await ensure();
                await h.insert(table).values(row).execute();
              });
            return {
              returning() {
                return gatedTable("write", table, async () => {
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
                return gatedTable("write", table, async () => {
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
        return gatedTable("read", table, async () => {
          const h = await ensure();
          return h.findById(table, id);
        });
      },
      delete(table: Parameters<SqlStoreHandle["delete"]>[0], id?: string) {
        if (id !== undefined) {
          return gatedTable("write", table, async () => {
            refuseDryRunWrite();
            const h = await ensure();
            return h.delete(table, id);
          });
        }
        return {
          where(where: unknown) {
            return gatedTable("write", table, async () => {
              refuseDryRunWrite();
              const h = await ensure();
              return h.delete(table).where(where);
            });
          },
        };
      },
      exists(table, idOrWhere) {
        return gatedTable("read", table, async () => {
          const h = await ensure();
          return h.exists(table, idOrWhere);
        });
      },
      upsert(table, matchOn, values, upsertOptions) {
        return gatedTable("write", table, async () => {
          refuseDryRunWrite();
          const h = await ensure();
          return h.upsert(table, matchOn, values, upsertOptions);
        });
      },
      increment(table, id, column, by) {
        return gatedTable("write", table, async () => {
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
        return gatedTable("read", table, async () => {
          const h = await ensure();
          return h.count(table, where);
        });
      },
      page(table, pageOptions) {
        return gatedTable("read", table, async () => {
          const h = await ensure();
          return h.page(table, pageOptions);
        });
      },
      ensureTable(table) {
        return gatedTable("write", table, async () => {
          refuseDryRunWrite();
          const h = await ensure();
          return h.ensureTable(table);
        });
      },
    } as SqlStoreHandle;
  }

  function kvTenantScoped(decl: KvStoreDecl): boolean {
    if (decl.tenantScoped === false) return false;
    if (decl.tenantScoped === true) return true;
    return options.tenantEnabled === true;
  }

  function tenantKvPrefix(): string {
    if (!tenant.id) throwOke("TENANT_REQUIRED");
    return `${tenant.id}:`;
  }

  function vaultStoragePath(contractName: string): string {
    const decl = options.vaultRuntime?.contracts.get(contractName);
    const perTenant =
      decl?.perTenant === true ||
      (options.tenantEnabled === true && decl !== undefined && decl.perTenant !== false);
    if (!perTenant) return contractName;
    if (!tenant.id) throwOke("TENANT_REQUIRED");
    return `${tenant.id}/${contractName}`;
  }

  function tenantKvArgs(decl: KvStoreDecl, prop: string | symbol, args: unknown[]): unknown[] {
    if (!kvTenantScoped(decl)) return args;
    const prefix = tenantKvPrefix();
    if (prop === "list") {
      const userPrefix = typeof args[0] === "string" ? args[0] : "";
      return [`${prefix}${userPrefix}`];
    }
    if (typeof args[0] !== "string") return args;
    return [`${prefix}${args[0]}`, ...args.slice(1)];
  }

  function stripTenantKvPrefix(decl: KvStoreDecl, keys: string[]): string[] {
    if (!kvTenantScoped(decl) || !tenant.id) return keys;
    const prefix = `${tenant.id}:`;
    return keys.map((k) => (k.startsWith(prefix) ? k.slice(prefix.length) : k));
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
            ...rlsInvokeContext(),
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
            ...rlsInvokeContext(),
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
          if (prop === "driverId") {
            const opened = cache.handle;
            if (opened && "driverId" in opened) return opened.driverId;
            if (decl.facet === "index") return runtime.indexDriverId ?? "memory";
            if (decl.facet === "kv") return runtime.kvDriverId ?? "memory";
            return "memory";
          }
          const isRead = prop === "get" || prop === "search" || prop === "list" || prop === "ttlMs";
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
              const callArgs =
                decl.facet === "kv" ? tenantKvArgs(decl as KvStoreDecl, prop, args) : args;
              const result = (fn as (...a: unknown[]) => unknown).apply(h, callArgs);
              if (decl.facet === "kv" && prop === "list") {
                return Promise.resolve(result as Promise<string[]>).then((keys) =>
                  stripTenantKvPrefix(decl as KvStoreDecl, keys),
                );
              }
              return result;
            });
        },
      });
    }
    return stubStoreHandle(resolveStoreRef(ref as NamedRef | { readonly ref: ResourceRef }));
  }

  const clock: FxClock = {
    now,
    ago(duration: string): number {
      return now() - parseDurationMs(duration);
    },
    fromNow(duration: string): number {
      return now() + parseDurationMs(duration);
    },
    duration(duration: string): number {
      return parseDurationMs(duration);
    },
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

  const vaultActor: VaultActor = {
    type: "flow",
    id: options.flow,
    ...(options.runId !== undefined ? { requestId: options.runId } : {}),
  };

  /**
   * Capability-check a vault path and ledger the `secret` effect around it.
   *
   * Kept off {@link gated} deliberately: secret access is never journaled,
   * so a durable replay re-reads the live value instead of resurrecting a
   * rotated one from the journal.
   *
   * @param name - Secret path
   * @param body - Work to run under the gate
   */
  async function gatedSecret<T>(name: string, body: () => T | Promise<T>): Promise<T> {
    capability.assert("secret", name);
    const timestamp = now();
    const t0 = performance.now();
    try {
      return await body();
    } finally {
      ledger.record({
        kind: "secret",
        resource: name,
        timestamp,
        duration: resolveDurationMs(now() - timestamp, performance.now() - t0),
        reversibility: reversibilityOf("secret"),
      });
    }
  }

  /**
   * @param op - Method name for the error message
   */
  function vaultAdapterFor(op: string): VaultAdapter {
    const adapter = options.vaultAdapter;
    if (!adapter) {
      throw new Error(
        `fx.vault.${op} needs a bound Vault backend — configure the vault element (drivers.vault = "vault") or pass vaultAdapter to createFx`,
      );
    }
    return adapter;
  }

  /**
   * @param op - Method name for the error message
   * @param path - Secret path
   */
  function refuseDryRunVaultWrite(op: string, path: string): void {
    if (isDryRun()) {
      throw new DryRunWriteIsolationError(
        `fx.vault.${op}("${path}") cannot isolate writes during dry-run; dry-run refused rather than risk mutating a live secret.`,
      );
    }
  }

  const vaultSurface: FxVault = {
    get(secret) {
      const name = resolveName(secret);
      return gatedSecret(name, async () => {
        const path = vaultStoragePath(name);
        if (path !== name) {
          if (options.vaultAdapter) {
            const rec = await options.vaultAdapter.get(path);
            if (!rec) {
              throw new Error(`fx.vault.get: missing per-tenant secret "${path}"`);
            }
            return new Redacted(rec.value);
          }
          const value = secrets[path] ?? secrets[name] ?? `[secret:${path}]`;
          return new Redacted(value);
        }
        const value = options.vaultRuntime
          ? options.vaultRuntime.read(name)
          : (secrets[name] ?? `[secret:${name}]`);
        return new Redacted(value);
      });
    },
    set(path, value, setOptions) {
      const name = resolveName(path);
      return gatedSecret(name, async () => {
        refuseDryRunVaultWrite("set", name);
        const storage = vaultStoragePath(name);
        const written = await vaultAdapterFor("set").set(storage, value, {
          ...(setOptions?.ttlMs !== undefined ? { ttlMs: setOptions.ttlMs } : {}),
          ...(setOptions?.metadata !== undefined ? { metadata: setOptions.metadata } : {}),
          actor: vaultActor,
        });
        return { path: written.path, version: written.version };
      });
    },
    rotate(path, value) {
      const name = resolveName(path);
      return gatedSecret(name, async () => {
        refuseDryRunVaultWrite("rotate", name);
        const storage = vaultStoragePath(name);
        const written = await vaultAdapterFor("rotate").rotate(storage, value, {
          actor: vaultActor,
        });
        return { path: written.path, version: written.version };
      });
    },
    delete(path) {
      const name = resolveName(path);
      return gatedSecret(name, async () => {
        refuseDryRunVaultWrite("delete", name);
        return vaultAdapterFor("delete").delete(vaultStoragePath(name), { actor: vaultActor });
      });
    },
    async list(prefix) {
      const entries = await vaultAdapterFor("list").list({
        ...(prefix !== undefined ? { prefix } : {}),
        actor: vaultActor,
      });
      return entries.map((entry) => entry.path);
    },
    async status() {
      const adapter = vaultAdapterFor("status");
      const state = await adapter.status();
      return { sealed: state.sealed, initialized: state.initialized, backend: adapter.id };
    },
  };

  const runsSurface: FxRuns = {
    query(sql) {
      return gated("read", RUNS_RESOURCE, async () => {
        if (!options.runsRuntime) {
          throw new Error("fx.runs.query requires a bound runs runtime (oke({ runs }))");
        }
        return options.runsRuntime.query(sql);
      });
    },
    all() {
      return gated("read", RUNS_RESOURCE, async () => {
        if (!options.runsRuntime) {
          throw new Error("fx.runs.all requires a bound runs runtime (oke({ runs }))");
        }
        return options.runsRuntime.all();
      });
    },
    async window(flowName, windowMs = 5 * 60_000) {
      return gated("read", RUNS_RESOURCE, async () => {
        if (!options.runsRuntime) {
          throw new Error("fx.runs.window requires a bound runs runtime (oke({ runs }))");
        }
        const { windowStatsForFlow } = await loadRunsWindow();
        const events = await options.runsRuntime.all();
        return windowStatsForFlow(events, flowName, now(), windowMs);
      });
    },
    async checkSlo(flowName, slo, windowMs = 5 * 60_000) {
      return gated("read", RUNS_RESOURCE, async () => {
        if (!options.runsRuntime) {
          throw new Error("fx.runs.checkSlo requires a bound runs runtime (oke({ runs }))");
        }
        const { windowStatsForFlow, evaluateSloBreaches } = await loadRunsWindow();
        const events = await options.runsRuntime.all();
        const stats = windowStatsForFlow(events, flowName, now(), windowMs);
        return evaluateSloBreaches(stats, slo);
      });
    },
  };

  const fx: Fx = {
    store: storeHandle,
    runs: runsSurface,
    emit(signal, payload, emitOptions) {
      const name = resolveName(signal);
      return gated("emit", name, async () => {
        if (options.signalRuntime) {
          const merged: SignalEmitOptions = {
            ...emitOptions,
            ...(options.runId !== undefined && emitOptions?.parentRunId === undefined
              ? { parentRunId: options.runId }
              : {}),
          };
          await options.signalRuntime.emit(name, payload, merged);
        }
      });
    },
    deadLetters(signal: NamedRef) {
      const name = resolveName(signal);
      return gated("read", signalReadRef(name), async () => {
        if (!options.signalRuntime) {
          throw new Error("fx.deadLetters requires a bound signal runtime");
        }
        return options.signalRuntime.deadLetters(name);
      });
    },
    live(
      signal: NamedRef,
      opts?: { readonly match?: (payload: unknown) => boolean; readonly afterId?: string },
    ) {
      return loadFxLiveStream().createLiveStream({
        name: resolveName(signal),
        afterId: opts?.afterId ?? options.lastEventId,
        match: opts?.match,
        gated,
        signalRuntime: options.signalRuntime,
      }) as JsonStreamResult;
    },
    call(flow, input) {
      const name = resolveName(flow);
      return gated("call", name, async () => {
        if (isMcpToolRef(name)) {
          if (!options.aiRuntime) {
            throw new Error(`fx.call: AI runtime is not configured for MCP tool "${name}"`);
          }
          return options.aiRuntime.callMcp(name, input, currentAbortSignal());
        }
        if (options.callHandler) {
          return options.callHandler(name, input);
        }
        return undefined;
      });
    },
    clock,
    vault: vaultSurface,
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
    sendOtp(opts) {
      return gated("send", "sms-otp", async () => {
        if (isDryRun()) {
          recordWouldHaveFired("send", "sms-otp");
          return { ok: true as const };
        }
        if (!options.channelRuntime) {
          throw new Error(
            "fx.sendOtp needs a bound Channel — declare channel and set drivers.channel.sms (e.g. taqnyat)",
          );
        }
        await options.channelRuntime.sendOtp({
          to: opts.to,
          requestId: opts.requestId,
          ...(opts.lang ? { lang: opts.lang } : {}),
          ...(opts.note ? { note: opts.note } : {}),
          ...(opts.from ? { from: opts.from } : {}),
        });
        return { ok: true as const };
      });
    },
    verifyOtp(opts) {
      return gated("send", "sms-otp", async () => {
        if (isDryRun()) {
          recordWouldHaveFired("send", "sms-otp");
          return { ok: true as const };
        }
        if (!options.channelRuntime) {
          throw new Error(
            "fx.verifyOtp needs a bound Channel — declare channel and set drivers.channel.sms (e.g. taqnyat)",
          );
        }
        await options.channelRuntime.verifyOtp({
          to: opts.to,
          requestId: opts.requestId,
          code: opts.code,
          ...(opts.lang ? { lang: opts.lang } : {}),
          ...(opts.from ? { from: opts.from } : {}),
          ...(opts.note ? { note: opts.note } : {}),
        });
        return { ok: true as const };
      });
    },
    deliverOtp(opts) {
      return gated("send", "auth-otp", async () => {
        if (isDryRun()) {
          recordWouldHaveFired("send", "auth-otp");
          return { ok: true as const, channel: opts.only ?? opts.channels[0] ?? "email" };
        }
        if (!options.channelRuntime) {
          throw new Error(
            "fx.deliverOtp needs a bound Channel — declare channel templates and drivers for the configured media",
          );
        }
        const result = await options.channelRuntime.deliverOtp({
          channels: opts.channels,
          templates: opts.templates,
          ...(opts.email ? { email: opts.email } : {}),
          ...(opts.phone ? { phone: opts.phone } : {}),
          data: opts.data,
          ...(opts.locale ? { locale: opts.locale } : {}),
          ...(opts.only ? { only: opts.only } : {}),
        });
        return { ok: true as const, channel: result.channel };
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
          try {
            return await options.aiRuntime.ask(name, input, {
              via: opts?.via?.map(resolveName),
              ...(opts?.timeout !== undefined ? { timeout: opts.timeout } : {}),
              tools: opts?.tools?.map(resolveName),
              maxSteps: opts?.maxSteps,
              // Host fx.call — same capability / ledger / Runs path as any call.
              callTool: (tool, toolInput) => fx.call(tool, toolInput),
            });
          } finally {
            stampAskTelemetry(telemetry, options.aiRuntime, name);
          }
        }
        throw new Error(`fx.ask: AI runtime is not configured for prompt "${name}"`);
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
            via: opts?.via?.map(resolveName),
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
      return loadMessages().translate({
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
      with: jsonWith,
      withQuery: jsonWithQuery,
      stream(chunks) {
        return {
          [jsonResultBrand]: true,
          kind: "stream" as const,
          status: 200 as const,
          chunks,
        };
      },
    },
    async step<T>(name: string, fn: () => T | Promise<T>, opts?: StepOptions<T>): Promise<T> {
      if (journal) {
        return journal.step(name, fn, opts);
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
