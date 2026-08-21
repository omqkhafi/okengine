/**
 * Console Store projection — Manifest + StoreRuntime over `fx` (console §9.5).
 *
 * The UI must not reimplement cache invalidation, PII masking, or effects graph.
 */

import { readSchemaFingerprint, schemaFingerprint } from "../../cli/schema.ts";
import {
  memoryFilesDriver,
  memoryIndexDriver,
  memoryKvDriver,
  memorySqlDriver,
} from "../../drivers/memory.ts";
import {
  computedCacheKey,
  createStoreRuntime,
  files as declareFiles,
  fileKeyWarnings,
  index as declareIndex,
  coerceSafeFileObjectKey,
  inferFileContentType,
  isInvalidatedByWrite,
  kv as declareKv,
  projectFileKeys,
  sql as declareSql,
  type FilesStoreFxHandle,
  type IndexStoreFxHandle,
  type KvStoreFxHandle,
  type SqlStoreHandle,
  type StoreRuntime,
} from "../../elements/store.ts";
import { RLS_CONTEXT_DRIVERS, type RlsIdentity } from "../../drivers/pg-rls.ts";
import { DryRunWriteIsolationError, withDryRun } from "../../kernel/dry-run.ts";
import { addPiiFieldName, piiNameAliases, PII_MASK } from "../../elements/store/classify.ts";
import { rankIndexHits } from "./index-search.ts";
import type {
  ColumnClassification,
  Effects,
  Manifest,
  ResourceRef,
  StoreFacet,
} from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";
import { consoleAuthStoreEnabled, projectConsoleAuthStore } from "./auth-store.ts";
import {
  fileObjectRecord,
  isFilesCatalogKey,
  readFilesCatalog,
  removeFilesCatalogRecords,
  upsertFilesCatalogRecord,
} from "./files-catalog.ts";
import {
  alterSqlPolicy,
  createSqlPolicy,
  dropSqlPolicy,
  applySqlTableRls,
  listSqlCatalog,
  listSqlTablePolicyCounts,
  listSqlTableRls,
  setSqlExtension,
  setSqlRowSecurity,
  sqlCatalogKind,
  sqlCatalogStoreChildren,
  upgradeSqlExtension,
} from "./sql-catalog.ts";

/** Whether multi-tenancy is declared on the Manifest (off by default). */
export function tenancyDeclared(manifest: Manifest | null): boolean {
  return manifest?.tenancy !== undefined;
}

/** Cache projection for one resource. */
export interface ConsoleStoreCacheView {
  /** Tier-1 key produced by a read of this resource. */
  readonly producedByRead: string;
  /** Write resource refs that invalidate the key. */
  readonly invalidatedByWrites: readonly string[];
  /** Flow ids whose writes touch this resource. */
  readonly invalidatingFlowIds: readonly string[];
}

/** Migration drift — declared schema fingerprint vs applied on disk. */
export interface ConsoleMigrationDrift {
  readonly declared: string;
  readonly applied: string | null;
  readonly drifted: boolean;
}

/** What a direct edit will NOT fire (Manifest effects of writers). */
export interface ConsoleWillNotFire {
  readonly writerFlowIds: readonly string[];
  readonly signals: readonly string[];
  readonly channels: readonly string[];
}

/** One child resource under a store (table / namespace / bucket / index). */
export interface ConsoleStoreChild {
  readonly name: string;
  /** Effect ref used in Manifest (`sql:bookings`). */
  readonly effectRef: ResourceRef;
  /** SQL catalog folder when not a table. */
  readonly kind?: "table" | "index" | "function" | "trigger" | "extension" | "policy";
  readonly writers: readonly string[];
  readonly readers: readonly string[];
  readonly cache: ConsoleStoreCacheView;
  readonly willNotFire: ConsoleWillNotFire;
  readonly piiColumns: readonly string[];
  /** Column key → optional human description (SQL tables). */
  readonly columnDescriptions: Readonly<Record<string, string>>;
  /** Live RLS (`pg_class.relrowsecurity`) when the engine can report it. */
  readonly rls?: boolean;
  /** Live + declared RLS policy count when the child is a SQL table. */
  readonly rlsPolicyCount?: number;
}

/** One row in `console.store.list`. */
export interface ConsoleStoreRow {
  readonly ref: ResourceRef;
  readonly facet: StoreFacet;
  readonly name: string;
  readonly description?: string;
  readonly children: readonly ConsoleStoreChild[];
  readonly replicaLagMs: number | null;
  readonly migrationDrift: ConsoleMigrationDrift | null;
  readonly contentAddressed: boolean;
  /** Files driver when the runtime could open the handle (`memory` / `fs` / `s3`). */
  readonly driverId?: "memory" | "fs" | "s3";
  readonly warnings: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly key: string;
  }>;
}

/** Options when projecting the store list. */
export interface ProjectStoresOptions {
  readonly manifest: Manifest | null;
  readonly runtime: StoreRuntime | null;
  readonly runs?: ReadonlyArray<Pick<WideEvent, "flow" | "replicaLagMs" | "effects" | "tenant">>;
  readonly cwd?: string;
  /** Injected fingerprints for tests. */
  readonly declaredFingerprint?: string;
  readonly appliedFingerprint?: string | null;
  /**
   * Surface `sql:oke_console` (operator-plane auth). Default: env
   * `OKE_CONSOLE_AUTH_STORE=1`.
   */
  readonly includeAuthStore?: boolean;
}

/**
 * Project Manifest stores into operator rows.
 *
 * @param options - Manifest, runtime, runs
 */
export async function projectStoresList(options: ProjectStoresOptions): Promise<{
  readonly stores: readonly ConsoleStoreRow[];
  readonly tenancyDeclared: boolean;
  readonly tenants: readonly string[];
}> {
  const manifest = options.manifest;
  const tenancy = tenancyDeclared(manifest);
  const tenants = tenancy ? collectTenants(options.runs ?? []) : [];

  let drift: ConsoleMigrationDrift | null = null;
  if (manifest) {
    const declared =
      options.declaredFingerprint ??
      (await schemaFingerprint(options.cwd ?? process.cwd(), manifest));
    const applied =
      options.appliedFingerprint !== undefined
        ? options.appliedFingerprint
        : await readSchemaFingerprint(options.cwd ?? process.cwd());
    drift = {
      declared,
      applied,
      drifted: applied !== null && applied !== declared,
    };
  }

  const stores: ConsoleStoreRow[] = [];
  for (const [name, store] of Object.entries(manifest?.stores ?? {})) {
    const facet = store.facet;
    const ref = `${facet}:${name}` as ResourceRef;
    const children = await withSqlTableRls(
      options.runtime,
      ref,
      facet,
      childrenOf(manifest!, name, facet, store),
      store.tables,
    );
    const replicaLagMs = facet === "sql" ? latestReplicaLag(options.runs ?? [], children) : null;

    let warnings: ConsoleStoreRow["warnings"] = [];
    let filesDriverId: FilesStoreFxHandle["driverId"] | undefined;
    if (facet === "files" && options.runtime) {
      try {
        const handle = (await options.runtime.openRef(ref, {
          effects: { reads: [ref] },
        })) as FilesStoreFxHandle;
        filesDriverId = handle.driverId;
        const keys = await handle.list();
        warnings = projectFileKeys(keys.filter((k) => !isFilesCatalogKey(k))).flatMap(
          (k) => k.warnings,
        );
      } catch {
        warnings = [];
      }
    }

    stores.push({
      ref,
      facet,
      name,
      ...(store.description !== undefined ? { description: store.description } : {}),
      children,
      replicaLagMs,
      migrationDrift: facet === "sql" ? drift : null,
      contentAddressed: facet === "files",
      ...(filesDriverId ? { driverId: filesDriverId } : {}),
      warnings,
    });
  }

  if (options.includeAuthStore ?? consoleAuthStoreEnabled()) {
    stores.push(projectConsoleAuthStore());
  }

  stores.sort((a, b) => {
    const order: StoreFacet[] = ["sql", "kv", "files", "index"];
    const d = order.indexOf(a.facet) - order.indexOf(b.facet);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });

  return { stores, tenancyDeclared: tenancy, tenants };
}

function childrenOf(
  manifest: Manifest,
  storeName: string,
  facet: StoreFacet,
  store: NonNullable<Manifest["stores"]>[string],
): ConsoleStoreChild[] {
  const names: string[] = [];
  if (facet === "sql") {
    names.push(...Object.keys(store.tables ?? {}));
    // Also surface table suffixes from effects when Manifest tables are sparse.
    for (const flow of Object.values(manifest.flows ?? {})) {
      for (const ref of [...(flow.effects?.reads ?? []), ...(flow.effects?.writes ?? [])]) {
        if (ref.startsWith("sql:")) {
          const table = ref.slice(4);
          if (!names.includes(table)) names.push(table);
        }
      }
    }
  } else if (facet === "kv") {
    names.push(...(store.namespaces ?? [storeName]));
  } else if (facet === "files") {
    names.push(...(store.buckets ?? [storeName]));
  } else {
    names.push(...(store.indexes ?? [storeName]));
  }

  const unique = [...new Set(names)].sort();
  const tables = unique.map((childName) => {
    const effectRef = `${facet}:${childName}` as ResourceRef;
    const writers = flowsTouching(manifest, effectRef, "writes");
    const readers = flowsTouching(manifest, effectRef, "reads");
    const willNotFire = willNotFireFor(manifest, writers);
    const piiColumns = piiColumnsFor(store, childName);
    const producedByRead = computedCacheKey(effectRef);
    const invalidatingFlowIds = writers;
    const invalidatedByWrites = writers.length > 0 ? [effectRef] : [];
    return {
      name: childName,
      effectRef,
      writers,
      readers,
      cache: {
        producedByRead,
        invalidatedByWrites,
        invalidatingFlowIds,
      },
      willNotFire,
      piiColumns,
      columnDescriptions: columnDescriptionsFor(store, childName),
      ...(facet === "sql" ? { kind: "table" as const, rls: false } : {}),
    };
  });
  if (facet !== "sql") return tables;
  return [...tables, ...sqlCatalogStoreChildren(`${facet}:${storeName}` as ResourceRef)];
}

async function withSqlTableRls(
  runtime: StoreRuntime | null,
  ref: ResourceRef,
  facet: StoreFacet,
  children: readonly ConsoleStoreChild[],
  tables?: NonNullable<Manifest["stores"]>[string]["tables"],
): Promise<readonly ConsoleStoreChild[]> {
  const declared = declaredTableRls(tables);
  const declaredCounts = declaredTablePolicyCounts(tables);
  if (facet !== "sql" || runtime === null) {
    return applySqlTableRls(children, new Map(), declared, declaredCounts);
  }
  try {
    const sql = (await runtime.openRef(ref, { effects: { reads: [ref] } })) as SqlStoreHandle;
    const policyCounts = mergePolicyCounts(await listSqlTablePolicyCounts(sql), declaredCounts);
    return applySqlTableRls(children, await listSqlTableRls(sql), declared, policyCounts);
  } catch {
    return applySqlTableRls(children, new Map(), declared, declaredCounts);
  }
}

function declaredTableRls(
  tables: NonNullable<Manifest["stores"]>[string]["tables"] | undefined,
): ReadonlyMap<string, boolean> {
  const out = new Map<string, boolean>();
  for (const [name, table] of Object.entries(tables ?? {})) {
    if (table.rls === true || Object.keys(table.policies ?? {}).length > 0) {
      out.set(name, true);
    }
  }
  return out;
}

function declaredTablePolicyCounts(
  tables: NonNullable<Manifest["stores"]>[string]["tables"] | undefined,
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const [name, table] of Object.entries(tables ?? {})) {
    const n = Object.keys(table.policies ?? {}).length;
    if (n > 0) out.set(name, n);
  }
  return out;
}

function mergePolicyCounts(
  live: ReadonlyMap<string, number>,
  declared: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map(declared);
  for (const [name, n] of live) {
    out.set(name, Math.max(n, out.get(name) ?? 0));
  }
  return out;
}

function columnDescriptionsFor(
  store: NonNullable<Manifest["stores"]>[string],
  tableName: string,
): Readonly<Record<string, string>> {
  const cols = store.tables?.[tableName]?.columns;
  if (!cols) return {};
  const out: Record<string, string> = {};
  for (const [key, col] of Object.entries(cols)) {
    if (col && typeof col === "object" && "description" in col) {
      const d = (col as { description?: string }).description;
      if (typeof d === "string" && d.length > 0) out[key] = d;
    }
  }
  return out;
}

function flowsTouching(manifest: Manifest, ref: ResourceRef, kind: "reads" | "writes"): string[] {
  const out: string[] = [];
  for (const [flowId, flow] of Object.entries(manifest.flows ?? {})) {
    if ((flow.effects?.[kind] ?? []).includes(ref)) out.push(flowId);
  }
  return out.sort();
}

/**
 * Signals / channels that writers of this table would emit/send — skipped on
 * a direct Console edit (not a flow execution).
 *
 * @param manifest - Manifest
 * @param writerFlowIds - Flows that write the resource
 */
export function willNotFireFor(
  manifest: Manifest,
  writerFlowIds: readonly string[],
): ConsoleWillNotFire {
  const signals = new Set<string>();
  const channels = new Set<string>();
  for (const flowId of writerFlowIds) {
    const flow = manifest.flows?.[flowId];
    for (const s of flow?.effects?.emits ?? []) signals.add(s);
    for (const c of flow?.effects?.sends ?? []) channels.add(c);
  }
  return {
    writerFlowIds: [...writerFlowIds],
    signals: [...signals].sort(),
    channels: [...channels].sort(),
  };
}

function piiColumnsFor(store: NonNullable<Manifest["stores"]>[string], table: string): string[] {
  const cols = new Set<string>();
  const tableMeta = store.tables?.[table];
  for (const [col, tags] of Object.entries(tableMeta?.columns ?? {})) {
    if (!tags?.pii) continue;
    addPiiFieldName(cols, col);
    const sqlName =
      "sqlName" in tags && typeof (tags as { sqlName?: unknown }).sqlName === "string"
        ? (tags as { sqlName: string }).sqlName
        : undefined;
    if (sqlName) addPiiFieldName(cols, sqlName);
  }
  for (const [key, tags] of Object.entries(store.classifications ?? {})) {
    if (
      key.startsWith(`${table}.`) &&
      tags &&
      typeof tags === "object" &&
      !Array.isArray(tags) &&
      "pii" in tags &&
      (tags as { pii?: boolean }).pii
    ) {
      addPiiFieldName(cols, key.slice(table.length + 1));
    }
  }
  return [...cols].sort();
}

function latestReplicaLag(
  runs: ReadonlyArray<Pick<WideEvent, "replicaLagMs" | "effects">>,
  children: readonly ConsoleStoreChild[],
): number | null {
  const refs = new Set(children.map((c) => c.effectRef));
  let lag: number | null = null;
  for (const run of runs) {
    if (run.replicaLagMs == null) continue;
    const touches = (run.effects ?? []).some((e) => refs.has(e.resource as ResourceRef));
    if (!touches) continue;
    if (lag === null || run.replicaLagMs > lag) lag = run.replicaLagMs;
  }
  return lag;
}

function collectTenants(runs: ReadonlyArray<{ readonly tenant?: string | null }>): string[] {
  const set = new Set<string>();
  for (const r of runs) {
    if (r.tenant) set.add(r.tenant);
  }
  return [...set].sort();
}

/** Query / browse input. */
export interface StoreQueryInput {
  readonly ref: ResourceRef;
  readonly child?: string;
  readonly tenant?: string;
  readonly prefix?: string;
  readonly limit?: number;
  readonly vector?: readonly number[];
  readonly q?: string;
  readonly topK?: number;
  readonly revealPii?: boolean;
  readonly asGate?: string;
  readonly asUserId?: string;
  readonly rls?: RlsIdentity;
}

/** Query result shape. */
export interface StoreQueryResult {
  readonly facet: StoreFacet;
  readonly rows?: readonly Record<string, unknown>[];
  readonly keys?: ReadonlyArray<{
    readonly key: string;
    readonly value?: unknown;
    readonly ttlMs?: number | null;
    readonly sizeBytes?: number;
    readonly originalName?: string;
    readonly warnings?: ReadonlyArray<{
      readonly code: string;
      readonly message: string;
    }>;
  }>;
  readonly hits?: ReadonlyArray<{
    readonly id: string;
    readonly score: number;
    readonly meta?: Record<string, unknown>;
  }>;
  readonly facetDistribution?: Record<string, Record<string, number>>;
  readonly masked: boolean;
  readonly routedRole?: "primary" | "replica";
  readonly rls?: {
    readonly gate: string | null;
    readonly userId: string;
    readonly applied: boolean;
  };
}

const KV_TTL_RE = /^(\d+)(ms|s|m|h|d)$/;

/**
 * Prefix for `kv.list` when Console browse does not pass an explicit one.
 *
 * A dedicated `store.kv("drafts")` keeps keys at the namespace root
 * (`ENG-184`). `${child}:` is only for a shared KV store whose children
 * are key prefixes (`kv:cache` / `drafts:…`).
 *
 * @param ref - Store ref (`kv:drafts`)
 * @param child - Selected child / namespace
 * @param explicit - Operator-supplied list prefix
 */
function kvBrowsePrefix(
  ref: string,
  child: string | undefined,
  explicit: string | undefined,
): string {
  if (explicit !== undefined) return explicit;
  if (!child) return "";
  const storeName = ref.split(":")[1] ?? "";
  if (child === storeName) return "";
  return `${child}:`;
}

/**
 * Resolve the TTL argument for `kv.set` from a Console patch.
 * Omitted `ttl` keeps the remaining expiry; `null` / empty clears it.
 *
 * @param patch - Edit patch
 * @param remainingMs - Current remaining TTL, or null
 */
function kvTtlFromPatch(
  patch: Readonly<Record<string, unknown>>,
  remainingMs: number | null,
): string | undefined {
  if (!("ttl" in patch)) {
    return remainingMs !== null && remainingMs > 0 ? `${Math.ceil(remainingMs)}ms` : undefined;
  }
  const raw = patch.ttl;
  if (raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || !KV_TTL_RE.test(raw.trim())) {
    throw new Error("TTL must be a duration like 30m, 1h, or empty to clear");
  }
  return raw.trim();
}

/** UTF-8 byte length of a JSON-serialized KV value. */
function kvValueSizeBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
  } catch {
    return 0;
  }
}

/**
 * Browse a store facet through the runtime (PII masked unless reveal).
 *
 * @param runtime - Store runtime
 * @param manifest - Manifest (classifications)
 * @param input - Browse input
 */
export async function queryStore(
  runtime: StoreRuntime,
  manifest: Manifest | null,
  input: StoreQueryInput,
): Promise<StoreQueryResult> {
  const [facet] = input.ref.split(":") as [StoreFacet, string];
  const effects: Effects = { reads: [input.ref] };
  const catalog = input.child ? sqlCatalogKind(input.child) : null;
  const rls = catalog ? undefined : input.rls;
  const handle = await runtime.openRef(input.ref, {
    effects,
    revealPii: input.revealPii === true,
    ...(rls ? { rls } : {}),
  });

  if (facet === "sql") {
    const sql = handle as SqlStoreHandle;
    const table = input.child;
    const stamped = rlsStamp(sql.driverId, rls);
    if (!table) {
      return {
        facet,
        rows: [],
        masked: !input.revealPii,
        routedRole: sql.routedRole,
        ...(stamped ? { rls: stamped } : {}),
      };
    }
    if (catalog) {
      const storeName = input.ref.split(":")[1] ?? "";
      const rows = await listSqlCatalog(sql, catalog, manifest, storeName, input.limit ?? 200);
      return { facet, rows, masked: false, routedRole: sql.routedRole };
    }
    const limit = input.limit ?? 50;
    let sqlText = `SELECT * FROM "${table}"`;
    const params: unknown[] = [];
    if (input.tenant !== undefined) {
      sqlText += ` WHERE "tenant_id" = ?`;
      params.push(input.tenant);
    }
    sqlText += ` LIMIT ${limit}`;
    try {
      const rows = await sql.raw(sqlText, params);
      return {
        facet,
        rows,
        masked: !input.revealPii,
        routedRole: sql.routedRole,
        ...(stamped ? { rls: stamped } : {}),
      };
    } catch {
      // Table may not exist yet — empty browse.
      return {
        facet,
        rows: [],
        masked: !input.revealPii,
        routedRole: sql.routedRole,
        ...(stamped ? { rls: stamped } : {}),
      };
    }
  }

  if (facet === "kv") {
    const kv = handle as KvStoreFxHandle;
    const keys = await kv.list(kvBrowsePrefix(input.ref, input.child, input.prefix));
    const limited = keys.slice(0, input.limit ?? 100);
    const entries = await Promise.all(
      limited.map(async (key) => {
        const value = await kv.get(key);
        return {
          key,
          value,
          ttlMs: await kv.ttlMs(key),
          sizeBytes: kvValueSizeBytes(value),
        };
      }),
    );
    return { facet, keys: entries, masked: false };
  }

  if (facet === "files") {
    const filesHandle = handle as FilesStoreFxHandle;
    const keys = (await filesHandle.list(input.prefix ?? "")).filter((k) => !isFilesCatalogKey(k));
    const catalog = await readFilesCatalog(filesHandle);
    const projected = projectFileKeys(keys.slice(0, input.limit ?? 100));
    const entries = await Promise.all(
      projected.map(async (k) => {
        const data = await filesHandle.get(k.key);
        const meta = catalog.objects[k.key];
        return {
          key: k.key,
          sizeBytes: data?.byteLength ?? 0,
          ...(meta ? { originalName: meta.originalName } : {}),
          warnings: k.warnings.map((w) => ({
            code: w.code,
            message: w.message,
          })),
        };
      }),
    );
    return { facet, keys: entries, masked: false };
  }

  // index — text query ranks stored meta; a vector still probes ANN.
  const idx = handle as IndexStoreFxHandle;
  void manifest;
  const topK = input.topK ?? 5;
  const listLimit = input.limit ?? 100;
  const q = input.q?.trim() ?? "";
  const vector = input.vector ?? [];

  if (idx.driverId === "meilisearch") {
    if (q.length > 0) {
      const result = await idx.search(q, { topK });
      return {
        facet,
        hits: result.hits,
        facetDistribution: result.facetDistribution,
        masked: false,
      };
    }
    return { facet, hits: await idx.list(listLimit), masked: false };
  }

  if (vector.length > 0) {
    return { facet, hits: await idx.search(vector, topK), masked: false };
  }
  if (q.length > 0) {
    return {
      facet,
      hits: rankIndexHits(await idx.list(INDEX_TEXT_SCAN), q, topK),
      masked: false,
    };
  }
  return { facet, hits: await idx.list(listLimit), masked: false };
}

/** How many documents a text query scans before ranking. */
const INDEX_TEXT_SCAN = 2_000;

/** Max object body returned by {@link getStoreFile} (2 MiB). */
export const STORE_FILE_BODY_MAX = 2_000_000;

/** Request for {@link getStoreFile}. */
export interface StoreFileGetInput {
  readonly ref: ResourceRef;
  readonly key: string;
  readonly tenant?: string;
}

/** Object payload for Console preview / download. */
export interface StoreFileObject {
  readonly key: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly encoding: "utf8" | "base64";
  readonly body: string;
  readonly truncated: boolean;
  readonly originalName?: string;
  readonly warnings: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
  }>;
}

/**
 * Read one files object for Console preview / download.
 *
 * @param runtime - Store runtime
 * @param input - Store ref + object key
 */
export async function getStoreFile(
  runtime: StoreRuntime,
  input: StoreFileGetInput,
): Promise<StoreFileObject> {
  const [facet] = input.ref.split(":") as [StoreFacet, string];
  if (facet !== "files") {
    throw new Error(`store object get requires a files ref, got ${input.ref}`);
  }
  const handle = (await runtime.openRef(input.ref, {
    effects: { reads: [input.ref] },
  })) as FilesStoreFxHandle;
  const data = await handle.get(input.key);
  if (!data) {
    throw new StoreFileNotFoundError(input.ref, input.key);
  }
  const truncated = data.byteLength > STORE_FILE_BODY_MAX;
  const slice = truncated ? data.subarray(0, STORE_FILE_BODY_MAX) : data;
  const catalog = await readFilesCatalog(handle);
  const meta = catalog.objects[input.key];
  const contentType = meta?.contentType ?? inferFileContentType(meta?.originalName ?? input.key);
  const asText = fileBytesAsUtf8(slice, contentType);
  return {
    key: input.key,
    sizeBytes: data.byteLength,
    contentType,
    encoding: asText !== null ? "utf8" : "base64",
    body: asText ?? bytesToBase64(slice),
    truncated,
    ...(meta ? { originalName: meta.originalName } : {}),
    warnings: fileKeyWarnings(input.key).map((w) => ({
      code: w.code,
      message: w.message,
    })),
  };
}

/** Missing object on {@link getStoreFile}. */
export class StoreFileNotFoundError extends Error {
  readonly ref: string;
  readonly key: string;

  constructor(ref: string, key: string) {
    super(`object not found: ${key}`);
    this.name = "StoreFileNotFoundError";
    this.ref = ref;
    this.key = key;
  }
}

function fileBytesAsUtf8(bytes: Uint8Array, contentType: string): string | null {
  if (bytes.includes(0)) return null;
  const textual =
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/xml" ||
    contentType === "application/javascript";
  if (!textual) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeFilePatchBody(patch: Readonly<Record<string, unknown>>): Uint8Array {
  const body = patch.body;
  if (typeof body !== "string") {
    throw new Error("files put requires string patch.body");
  }
  if (patch.encoding === "utf8") {
    return new TextEncoder().encode(body);
  }
  if (patch.encoding !== undefined && patch.encoding !== "base64") {
    throw new Error("files put encoding must be utf8 or base64");
  }
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Options for a direct edit (not a flow execution). */
export interface StoreEditInput {
  readonly ref: ResourceRef;
  readonly child?: string;
  readonly tenant?: string;
  readonly id?: string;
  readonly key?: string;
  /** Column values. Omit {@link StoreEditInput.id} to INSERT (requires `patch.id`). */
  readonly patch: Record<string, unknown>;
  readonly confirmation?: string;
  readonly reason?: string;
  readonly confirmed?: boolean;
  readonly asGate?: string;
  readonly asUserId?: string;
  readonly rls?: RlsIdentity;
}

/** Result of a direct store edit (preview or applied). */
export interface StoreEditResult {
  readonly ok: true;
  readonly dryRun: boolean;
  readonly willNotFire: ConsoleWillNotFire;
  readonly applied: boolean;
  readonly wouldHaveFired: ReadonlyArray<{
    readonly kind: "send" | "ask";
    readonly resource: string;
  }>;
  readonly rls?: {
    readonly gate: string | null;
    readonly userId: string;
    readonly applied: boolean;
  };
}

/**
 * Preview or apply a direct row/key edit. Direct edit is NOT a flow execution.
 *
 * @param runtime - Store runtime
 * @param manifest - Manifest
 * @param input - Edit input
 * @param options - Production / dry-run
 */
export async function editStore(
  runtime: StoreRuntime,
  manifest: Manifest | null,
  input: StoreEditInput,
  options: {
    readonly production: boolean;
    readonly dryRun?: boolean;
  },
): Promise<StoreEditResult> {
  const effectRef = (
    input.child && input.ref.startsWith("sql:") ? `sql:${input.child}` : input.ref
  ) as ResourceRef;
  const writers = manifest ? flowsTouching(manifest, effectRef, "writes") : [];
  const willNotFire = willNotFireFor(manifest ?? { oke: "1.0", app: "" }, writers);

  if (options.dryRun) {
    // Dual test: withDryRun stubs send/ask; we also snapshot touched keys/rows
    // and restore after — memory KV/SQL drivers do not auto-register with
    // touchDryRunStore the way stub fx.store maps do.
    const snapshot = await snapshotEditTarget(runtime, input);
    try {
      const { wouldHaveFired } = await withDryRun(async () => {
        await applyEdit(runtime, input, { revealPii: false, persistMeta: false });
      });
      await restoreEditTarget(runtime, snapshot);
      return {
        ok: true,
        dryRun: true,
        willNotFire,
        applied: false,
        wouldHaveFired,
        ...(input.rls
          ? {
              rls: {
                gate: input.rls.gate,
                userId: input.rls.userId,
                applied: false,
              },
            }
          : {}),
      };
    } catch (err) {
      await restoreEditTarget(runtime, snapshot);
      if (err instanceof DryRunWriteIsolationError) {
        throw err;
      }
      throw err;
    }
  }

  const appliedRls = await applyEdit(
    runtime,
    input,
    { revealPii: false, persistMeta: true },
    manifest,
  );
  // Direct edit: invalidate cache for written resource (effects-derived).
  runtime.onWriteEffects({ writes: [effectRef] });
  void options.production;
  return {
    ok: true,
    dryRun: false,
    willNotFire,
    applied: true,
    wouldHaveFired: [],
    ...(appliedRls ? { rls: appliedRls } : {}),
  };
}

/** Snapshot of a direct-edit target for dry-run rollback. */
type EditSnapshot =
  | {
      readonly kind: "kv";
      readonly ref: ResourceRef;
      readonly key: string;
      readonly value: unknown;
      readonly ttlMs: number | null;
    }
  | {
      readonly kind: "sql";
      readonly ref: ResourceRef;
      readonly child: string;
      readonly id: string;
      readonly row: Record<string, unknown> | null;
    }
  | {
      readonly kind: "extension";
      readonly ref: ResourceRef;
      readonly name: string;
      readonly enabled: boolean;
      readonly version: string | null;
    }
  | {
      readonly kind: "policy";
      readonly ref: ResourceRef;
      readonly id: string;
      readonly existed: boolean;
    }
  | {
      readonly kind: "files";
      readonly ref: ResourceRef;
      readonly key: string;
      readonly data: Uint8Array | null;
      readonly writtenKey: string;
      readonly writtenData: Uint8Array | null;
    }
  | { readonly kind: "none" };

async function snapshotEditTarget(
  runtime: StoreRuntime,
  input: StoreEditInput,
): Promise<EditSnapshot> {
  const [facet] = input.ref.split(":") as [StoreFacet, string];
  if (facet === "files" && input.key) {
    const filesHandle = (await runtime.openRef(input.ref, {
      effects: { reads: [input.ref] },
    })) as FilesStoreFxHandle;
    const writtenKey = coerceSafeFileObjectKey(input.key);
    const data = await filesHandle.get(input.key);
    return {
      kind: "files",
      ref: input.ref,
      key: input.key,
      data,
      writtenKey,
      writtenData: writtenKey === input.key ? data : await filesHandle.get(writtenKey),
    };
  }
  if (facet === "kv" && input.key) {
    const kv = (await runtime.openRef(input.ref, {
      effects: { reads: [input.ref] },
    })) as KvStoreFxHandle;
    return {
      kind: "kv",
      ref: input.ref,
      key: input.key,
      value: await kv.get(input.key),
      ttlMs: await kv.ttlMs(input.key),
    };
  }
  if (facet === "sql" && input.child && input.id && sqlCatalogKind(input.child) === "policy") {
    const sql = (await runtime.openRef(input.ref, {
      effects: { reads: [input.ref] },
    })) as SqlStoreHandle;
    const rows = await listSqlCatalog(sql, "policy", null, "", 500);
    return {
      kind: "policy",
      ref: input.ref,
      id: input.id,
      existed: rows.some((r) => String(r.id) === input.id),
    };
  }
  if (facet === "sql" && input.child && input.id && sqlCatalogKind(input.child) === "extension") {
    const sql = (await runtime.openRef(input.ref, {
      effects: { reads: [input.ref] },
    })) as SqlStoreHandle;
    const rows = await listSqlCatalog(sql, "extension", null, "", 500);
    const row = rows.find((r) => String(r.name) === input.id);
    return {
      kind: "extension",
      ref: input.ref,
      name: input.id,
      enabled: row?.enabled === true,
      version: typeof row?.version === "string" ? row.version : null,
    };
  }
  if (facet === "sql" && input.child) {
    const id = input.id ?? sqlInsertRowId(input.patch);
    if (id) {
      const sql = (await runtime.openRef(input.ref, {
        effects: { reads: [input.ref] },
      })) as SqlStoreHandle;
      try {
        const rows = await sql.raw(`SELECT * FROM "${input.child}" WHERE "id" = ? LIMIT 1`, [id]);
        return {
          kind: "sql",
          ref: input.ref,
          child: input.child,
          id,
          row: rows[0] ?? null,
        };
      } catch {
        return {
          kind: "sql",
          ref: input.ref,
          child: input.child,
          id,
          row: null,
        };
      }
    }
  }
  return { kind: "none" };
}

async function restoreEditTarget(runtime: StoreRuntime, snapshot: EditSnapshot): Promise<void> {
  if (snapshot.kind === "files") {
    const filesHandle = (await runtime.openRef(snapshot.ref, {
      effects: { writes: [snapshot.ref] },
    })) as FilesStoreFxHandle;
    if (snapshot.writtenKey !== snapshot.key) {
      if (snapshot.writtenData === null) {
        await filesHandle.delete(snapshot.writtenKey);
      } else {
        await filesHandle.put(snapshot.writtenKey, snapshot.writtenData);
      }
    }
    if (snapshot.data === null) {
      await filesHandle.delete(snapshot.key);
    } else {
      await filesHandle.put(snapshot.key, snapshot.data);
    }
    return;
  }
  if (snapshot.kind === "kv") {
    const kv = (await runtime.openRef(snapshot.ref, {
      effects: { writes: [snapshot.ref] },
    })) as KvStoreFxHandle;
    if (snapshot.value === undefined) {
      await kv.delete(snapshot.key);
    } else {
      const ttl =
        snapshot.ttlMs !== null && snapshot.ttlMs > 0
          ? `${Math.ceil(snapshot.ttlMs)}ms`
          : undefined;
      await kv.set(snapshot.key, snapshot.value, ttl);
    }
    return;
  }
  if (snapshot.kind === "policy") {
    if (snapshot.existed) return;
    const sql = (await runtime.openRef(snapshot.ref, {
      effects: { writes: [snapshot.ref] },
    })) as SqlStoreHandle;
    try {
      await dropSqlPolicy(sql, snapshot.id);
    } catch {
      /* best-effort restore */
    }
    return;
  }
  if (snapshot.kind === "extension") {
    const sql = (await runtime.openRef(snapshot.ref, {
      effects: { writes: [snapshot.ref] },
    })) as SqlStoreHandle;
    await setSqlExtension(sql, snapshot.name, snapshot.enabled);
    if (snapshot.enabled && snapshot.version) {
      await upgradeSqlExtension(sql, snapshot.name, snapshot.version);
    }
    return;
  }
  if (snapshot.kind === "sql") {
    const sql = (await runtime.openRef(snapshot.ref, {
      effects: { writes: [snapshot.ref] },
    })) as SqlStoreHandle;
    if (snapshot.row === null) {
      try {
        await sql.raw(`DELETE FROM "${snapshot.child}" WHERE "id" = ?`, [snapshot.id]);
      } catch {
        /* table may not exist */
      }
      return;
    }
    const cols = Object.keys(snapshot.row);
    const assignments = cols.map((c) => `"${c}" = ?`).join(", ");
    try {
      await sql.raw(`UPDATE "${snapshot.child}" SET ${assignments} WHERE "id" = ?`, [
        ...cols.map((c) => snapshot.row![c]),
        snapshot.id,
      ]);
    } catch {
      /* best-effort restore */
    }
  }
}

function findFileObjectsTable(
  manifest: Manifest | null,
): { readonly ref: ResourceRef; readonly table: string } | null {
  if (!manifest?.stores) return null;
  for (const [name, store] of Object.entries(manifest.stores)) {
    if (store.facet === "sql" && store.tables && "file_objects" in store.tables) {
      return { ref: `sql:${name}` as ResourceRef, table: "file_objects" };
    }
  }
  return null;
}

async function upsertFileObjectsSql(
  runtime: StoreRuntime,
  manifest: Manifest | null,
  storeRef: string,
  row: {
    readonly objectKey: string;
    readonly originalName: string;
    readonly contentType: string;
    readonly sizeBytes: number;
  },
): Promise<void> {
  const found = findFileObjectsTable(manifest);
  if (!found) return;
  try {
    const sql = (await runtime.openRef(found.ref, {
      effects: { writes: [found.ref] },
    })) as SqlStoreHandle;
    const existing = await sql.raw(
      `SELECT "id" FROM "${found.table}" WHERE "object_key" = ? LIMIT 1`,
      [row.objectKey],
    );
    if (existing.length > 0) {
      await sql.raw(
        `UPDATE "${found.table}" SET "original_name" = ?, "content_type" = ?, "size_bytes" = ?, "store_ref" = ? WHERE "object_key" = ?`,
        [row.originalName, row.contentType, row.sizeBytes, storeRef, row.objectKey],
      );
      return;
    }
    await sql.raw(
      `INSERT INTO "${found.table}" ("id", "object_key", "original_name", "content_type", "size_bytes", "store_ref") VALUES (?, ?, ?, ?, ?, ?)`,
      [row.objectKey, row.objectKey, row.originalName, row.contentType, row.sizeBytes, storeRef],
    );
  } catch {
    /* table missing or driver refused — catalog still holds the row */
  }
}

async function deleteFileObjectsSql(
  runtime: StoreRuntime,
  manifest: Manifest | null,
  storeRef: string,
  keys: readonly string[],
): Promise<void> {
  const found = findFileObjectsTable(manifest);
  if (!found || keys.length === 0) return;
  try {
    const sql = (await runtime.openRef(found.ref, {
      effects: { writes: [found.ref] },
    })) as SqlStoreHandle;
    for (const key of keys) {
      await sql.raw(`DELETE FROM "${found.table}" WHERE "object_key" = ? AND "store_ref" = ?`, [
        key,
        storeRef,
      ]);
    }
  } catch {
    /* best-effort */
  }
}

async function applyEdit(
  runtime: StoreRuntime,
  input: StoreEditInput,
  ctx: { readonly revealPii: boolean; readonly persistMeta?: boolean },
  manifest?: Manifest | null,
): Promise<StoreEditResult["rls"] | undefined> {
  const [facet] = input.ref.split(":") as [StoreFacet, string];
  const catalog = input.child ? sqlCatalogKind(input.child) : null;
  const rls = catalog ? undefined : input.rls;
  const handle = await runtime.openRef(input.ref, {
    effects: { writes: [input.ref] },
    revealPii: ctx.revealPii,
    ...(rls ? { rls } : {}),
  });

  if (facet === "files") {
    const filesHandle = handle as FilesStoreFxHandle;
    const requested = input.key;
    if (!requested) throw new Error("files edit requires key");
    const bytes = decodeFilePatchBody(input.patch);
    const key = coerceSafeFileObjectKey(requested);
    const originalName =
      typeof input.patch.originalName === "string" && input.patch.originalName.trim().length > 0
        ? input.patch.originalName.trim()
        : requested.slice(requested.lastIndexOf("/") + 1);
    await filesHandle.put(key, bytes);
    if (key !== requested) {
      await filesHandle.delete(requested);
    }
    if (ctx.persistMeta !== false) {
      if (key !== requested) {
        await removeFilesCatalogRecords(filesHandle, [requested]);
        await deleteFileObjectsSql(runtime, manifest ?? null, input.ref, [requested]);
      }
      await upsertFilesCatalogRecord(
        filesHandle,
        key,
        fileObjectRecord(originalName, bytes.byteLength, key),
      );
      await upsertFileObjectsSql(runtime, manifest ?? null, input.ref, {
        objectKey: key,
        originalName,
        contentType: inferFileContentType(originalName),
        sizeBytes: bytes.byteLength,
      });
    }
    return;
  }

  if (facet === "kv") {
    const kv = handle as KvStoreFxHandle;
    const key = input.key;
    if (!key) throw new Error("kv edit requires key");
    const current = await kv.get(key);
    const nextValue = "value" in input.patch ? input.patch.value : current;
    if (nextValue === undefined) {
      throw new Error("kv edit requires a value for a new key");
    }
    const ttl = kvTtlFromPatch(input.patch, await kv.ttlMs(key));
    await kv.set(key, nextValue, ttl);
    return;
  }

  if (facet === "sql") {
    const sql = handle as SqlStoreHandle;
    const table = input.child;
    const id = input.id;
    if (!table) throw new Error("sql edit requires child");
    if (!id && sqlCatalogKind(table) !== null) {
      throw new Error("sql edit requires child + id");
    }
    if (id && sqlCatalogKind(table) === "policy") {
      if (input.patch.create === true) {
        await createSqlPolicy(sql, input.patch);
        return;
      }
      if (input.patch.drop === true) {
        await dropSqlPolicy(sql, id);
        return;
      }
      if (typeof input.patch.rls === "boolean") {
        const tableName = typeof input.patch.table === "string" ? input.patch.table : id;
        await setSqlRowSecurity(sql, tableName, input.patch.rls);
        return;
      }
      await alterSqlPolicy(sql, id, input.patch);
      return;
    }
    if (id && sqlCatalogKind(table) === "extension") {
      if (input.patch.upgrade === true) {
        const to = typeof input.patch.version === "string" ? input.patch.version : undefined;
        await setSqlExtension(sql, id, true);
        await upgradeSqlExtension(sql, id, to);
        return;
      }
      const enabled = input.patch.enabled;
      if (typeof enabled !== "boolean") {
        throw new Error("extension edit requires boolean enabled or upgrade");
      }
      await setSqlExtension(sql, id, enabled, {
        ...(typeof input.patch.schema === "string" ? { schema: input.patch.schema } : {}),
        ...(typeof input.patch.version === "string" ? { version: input.patch.version } : {}),
        ...(input.patch.cascade === true ? { cascade: true } : {}),
      });
      return;
    }
    const sets = Object.keys(input.patch);
    if (sets.length === 0) return;
    const pii = piiColumnsForRef(runtime, input.ref, table);
    for (const column of sets) {
      if (pii.has(column) && input.patch[column] === PII_MASK) {
        throw new Error(
          `refusing to persist PII mask placeholder over column "${column}" — reveal or set a new value`,
        );
      }
    }
    if (!id) {
      const insertId = sqlInsertRowId(input.patch);
      if (!insertId) throw new Error("sql insert requires an id in the patch");
      const columns = sets.map((c) => `"${c}"`).join(", ");
      const placeholders = sets.map(() => "?").join(", ");
      await sql.raw(
        `INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`,
        sets.map((c) => input.patch[c]),
      );
      return rlsStamp(sql.driverId, rls);
    }
    const assignments = sets.map((c) => `"${c}" = ?`).join(", ");
    const params = [...sets.map((c) => input.patch[c]), id];
    await sql.raw(`UPDATE "${table}" SET ${assignments} WHERE "id" = ?`, params);
    return rlsStamp(sql.driverId, rls);
  }

  throw new Error(`direct edit not supported for facet ${facet}`);
}

/**
 * Row id for a SQL insert (`patch.id`). Used when `input.id` is omitted.
 *
 * @param patch - Insert column values
 */
function sqlInsertRowId(patch: Readonly<Record<string, unknown>>): string | undefined {
  const raw = patch.id;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return undefined;
}

/** PII columns for a SQL child from the Manifest bound to this runtime. */
function piiColumnsForRef(
  runtime: StoreRuntime,
  ref: ResourceRef,
  table: string,
): ReadonlySet<string> {
  const manifest = runtimeManifest.get(runtime);
  const storeName = ref.split(":")[1];
  if (!storeName) return new Set();
  const store = manifest?.stores?.[storeName];
  if (!store) return new Set();
  return new Set(piiColumnsFor(store, table));
}

/** Manifest captured when the Console runtime is created (for PII guard). */
const runtimeManifest = new WeakMap<StoreRuntime, Manifest | null>();

/** Delete rows/keys. */
export interface StoreDeleteInput {
  readonly ref: ResourceRef;
  readonly child?: string;
  readonly tenant?: string;
  readonly ids?: readonly string[];
  readonly keys?: readonly string[];
}

/**
 * Delete rows or keys through the runtime.
 *
 * @param runtime - Store runtime
 * @param input - Delete input
 */
export async function deleteStore(
  runtime: StoreRuntime,
  input: StoreDeleteInput,
  manifest?: Manifest | null,
): Promise<{ readonly deleted: number }> {
  const [facet] = input.ref.split(":") as [StoreFacet, string];
  const handle = await runtime.openRef(input.ref, {
    effects: { writes: [input.ref] },
  });
  let deleted = 0;
  if (facet === "kv") {
    const kv = handle as KvStoreFxHandle;
    for (const key of input.keys ?? []) {
      if (await kv.delete(key)) deleted++;
    }
  } else if (facet === "files") {
    const filesHandle = handle as FilesStoreFxHandle;
    const removed: string[] = [];
    for (const key of input.keys ?? []) {
      if (isFilesCatalogKey(key)) continue;
      if (await filesHandle.delete(key)) {
        deleted++;
        removed.push(key);
      }
    }
    await removeFilesCatalogRecords(filesHandle, removed);
    await deleteFileObjectsSql(runtime, manifest ?? null, input.ref, removed);
  } else if (facet === "sql") {
    const sql = handle as SqlStoreHandle;
    const table = input.child;
    if (!table) return { deleted: 0 };
    for (const id of input.ids ?? []) {
      await sql.raw(`DELETE FROM "${table}" WHERE "id" = ?`, [id]);
      deleted++;
    }
  } else if (facet === "index") {
    const idx = handle as IndexStoreFxHandle;
    for (const id of input.ids ?? []) {
      if (await idx.delete(id)) deleted++;
    }
  }
  const effectRef = (
    input.child && facet === "sql" ? `sql:${input.child}` : input.ref
  ) as ResourceRef;
  runtime.onWriteEffects({ writes: [effectRef] });
  return { deleted };
}

/**
 * Purge cache keys for a resource namespace (effects-derived invalidation).
 *
 * @param runtime - Store runtime
 * @param resource - Resource ref
 */
export function purgeStoreCache(
  runtime: StoreRuntime,
  resource: ResourceRef,
): { readonly keys: readonly string[] } {
  const event = runtime.cache.invalidate([resource]);
  // Also drop any live keys matching the computed prefix.
  const prefix = computedCacheKey(resource);
  const extra: string[] = [];
  for (const key of runtime.cache.keys()) {
    if (key === prefix || key.startsWith(`${prefix}/`)) {
      extra.push(key);
    }
  }
  if (extra.length > 0) {
    runtime.cache.invalidate([resource]);
  }
  return { keys: [...new Set([...event.keys, ...extra])] };
}

/**
 * True when `name` is `public` or a declared policy Gate (rate gates excluded).
 *
 * @param manifest - Current Manifest
 * @param name - Gate name from the query console
 */
export function isKnownConsoleSqlGate(manifest: Manifest | null, name: string): boolean {
  if (name === "public") return true;
  const gate = manifest?.gates?.[name];
  if (!gate) return false;
  return gate.kind !== "rate" && !name.startsWith("rate:");
}

function rlsStamp(
  driverId: string,
  identity: RlsIdentity | undefined,
):
  | {
      readonly gate: string | null;
      readonly userId: string;
      readonly applied: boolean;
    }
  | undefined {
  if (!identity) return undefined;
  return {
    gate: identity.gate,
    userId: identity.userId,
    applied: RLS_CONTEXT_DRIVERS.has(driverId),
  };
}

/** DML / DDL heads — keep in sync with `isSqlWrite` in the query console. */
const STORE_SQL_WRITE_HEADS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "REPLACE",
  "GRANT",
  "REVOKE",
  "VACUUM",
  "COMMENT",
  "COPY",
  "CALL",
  "REFRESH",
  "MERGE",
]);

/**
 * True when console SQL mutates the store (DML / DDL / `EXPLAIN ANALYZE`).
 *
 * @param sql - One statement (already trimmed)
 */
export function isStoreSqlWrite(sql: string): boolean {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  const head = /^([A-Za-z]+)/.exec(trimmed)?.[1]?.toUpperCase() ?? "";
  if (head === "EXPLAIN") return /\bANALYZE\b/i.test(trimmed);
  if (head === "ANALYZE") return true;
  return STORE_SQL_WRITE_HEADS.has(head);
}

/**
 * Raw SQL console — read-only by default.
 *
 * @param runtime - Store runtime
 * @param ref - SQL store ref
 * @param sqlText - SQL
 * @param options - Write allow + reveal + optional Gate
 */
export async function runStoreSql(
  runtime: StoreRuntime,
  ref: ResourceRef,
  sqlText: string,
  options: {
    readonly allowWrite: boolean;
    readonly revealPii?: boolean;
    readonly tenant?: string;
    /** View rows as this Gate (`oke.gate` on postgres / pglite). */
    readonly asGate?: string;
    readonly asUserId?: string;
    readonly rls?: RlsIdentity;
  },
): Promise<{
  readonly rows: readonly Record<string, unknown>[];
  readonly masked: boolean;
  readonly routedRole: "primary" | "replica";
  readonly asGate: string | null;
  readonly asUserId: string | null;
  readonly gateApplied: boolean;
  readonly rls: {
    readonly gate: string | null;
    readonly userId: string;
    readonly applied: boolean;
  };
}> {
  const trimmed = sqlText.trim().replace(/;+\s*$/, "");
  const isWrite = isStoreSqlWrite(trimmed);
  if (isWrite && !options.allowWrite) {
    throw new Error("SQL console is read-only by default — write requires console:store.sql:write");
  }
  const rls = options.rls;
  const handle = (await runtime.openRef(ref, {
    effects: isWrite ? { writes: [ref] } : { reads: [ref] },
    revealPii: options.revealPii === true,
    ...(rls ? { rls } : {}),
  })) as SqlStoreHandle;
  const stamped = rlsStamp(handle.driverId, rls) ?? {
    gate: rls?.gate ?? options.asGate?.trim() ?? null,
    userId: rls?.userId ?? options.asUserId?.trim() ?? "",
    applied: false,
  };
  const rows = await handle.raw(trimmed);
  return {
    rows,
    masked: !options.revealPii,
    routedRole: handle.routedRole,
    asGate: stamped.gate,
    asUserId: stamped.userId.length > 0 ? stamped.userId : options.asUserId?.trim() || null,
    gateApplied: stamped.applied,
    rls: stamped,
  };
}

/**
 * Whether a cache key would be invalidated by writers of a resource — pure
 * projection over {@link isInvalidatedByWrite}.
 *
 * @param key - Cache key
 * @param writeRef - Written resource
 */
export function cacheKeyInvalidatedBy(key: string, writeRef: ResourceRef): boolean {
  return isInvalidatedByWrite(key, { writes: [writeRef] });
}

/**
 * Open a memory StoreRuntime seeded from Manifest stores (Console default).
 *
 * The Console Manifest sandbox uses memory drivers for every facet. Real app
 * boot resolves configured drivers before the Console binds to live runtimes.
 *
 * @param manifest - Manifest snapshot
 * @param now - Clock
 */
export async function createManifestStoreRuntime(
  manifest: Manifest | null,
  now: () => number = () => Date.now(),
): Promise<StoreRuntime> {
  const runtime = createStoreRuntime({
    drivers: {
      sql: memorySqlDriver,
      kv: memoryKvDriver,
      files: memoryFilesDriver,
      index: memoryIndexDriver,
    },
    now,
  });
  for (const [name, store] of Object.entries(manifest?.stores ?? {})) {
    switch (store.facet) {
      case "sql":
        runtime.register(
          declareSql(name, {
            classify: sqlClassifyFromManifest(store),
          }),
        );
        break;
      case "kv":
        runtime.register(declareKv(name));
        break;
      case "files":
        runtime.register(declareFiles(name));
        break;
      case "index":
        runtime.register(declareIndex(name, { dims: 3 }));
        break;
    }
  }
  runtimeManifest.set(runtime, manifest);
  return runtime;
}

/**
 * Merge flat `store.classifications` with table-column tags from Manifest
 * `stores.*.tables.*.columns` into the nested `table → column → tags` shape
 * {@link declareSql} expects (driver-boundary masking).
 *
 * @param store - Manifest store row
 */
function sqlClassifyFromManifest(
  store: NonNullable<Manifest["stores"]>[string],
): Readonly<Record<string, Readonly<Record<string, ColumnClassification>>>> {
  const nested: Record<string, Record<string, ColumnClassification>> = {};

  for (const [key, value] of Object.entries(store.classifications ?? {})) {
    const dot = key.indexOf(".");
    if (dot <= 0) continue;
    const table = key.slice(0, dot);
    const column = key.slice(dot + 1);
    if (column.length === 0) continue;
    const tags = classificationFromValue(value);
    if (!tags) continue;
    putClassifyAliases(nested, table, column, tags);
  }

  for (const [table, meta] of Object.entries(store.tables ?? {})) {
    for (const [column, tags] of Object.entries(meta.columns ?? {})) {
      const normalized = classificationFromValue(tags);
      if (!normalized) continue;
      putClassifyAliases(nested, table, column, normalized);
      const sqlName =
        "sqlName" in tags && typeof (tags as { sqlName?: unknown }).sqlName === "string"
          ? (tags as { sqlName: string }).sqlName
          : undefined;
      if (sqlName) putClassifyAliases(nested, table, sqlName, normalized);
    }
  }

  return nested;
}

/**
 * Register classify tags under JS and SQL spellings of a column.
 *
 * @param nested - table → column → tags
 * @param table - Table name
 * @param column - Manifest or SQL column name
 * @param tags - Classification tags
 */
function putClassifyAliases(
  nested: Record<string, Record<string, ColumnClassification>>,
  table: string,
  column: string,
  tags: ColumnClassification,
): void {
  const row = { ...(nested[table] ?? {}) };
  for (const name of piiNameAliases(column)) {
    row[name] = tags;
  }
  nested[table] = row;
}

/**
 * Normalize a Manifest classification value into tags, or null when not a
 * tag object (e.g. string / string[] classification forms).
 *
 * @param value - Manifest classification value
 */
function classificationFromValue(value: unknown): ColumnClassification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const tags: ColumnClassification = {};
  if (v.pii === true) tags.pii = true;
  if (v.sensitive === true) tags.sensitive = true;
  if (typeof v.retain === "string") tags.retain = v.retain;
  return Object.keys(tags).length > 0 ? tags : null;
}
