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
  index as declareIndex,
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
import { DryRunWriteIsolationError, withDryRun } from "../../kernel/dry-run.ts";
import type { Effects, Manifest, ResourceRef, StoreFacet } from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";

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
  readonly writers: readonly string[];
  readonly readers: readonly string[];
  readonly cache: ConsoleStoreCacheView;
  readonly willNotFire: ConsoleWillNotFire;
  readonly piiColumns: readonly string[];
  /** Column key → optional human description (SQL tables). */
  readonly columnDescriptions: Readonly<Record<string, string>>;
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
    const children = childrenOf(manifest!, name, facet, store);
    const replicaLagMs = facet === "sql" ? latestReplicaLag(options.runs ?? [], children) : null;

    let warnings: ConsoleStoreRow["warnings"] = [];
    if (facet === "files" && options.runtime) {
      try {
        const handle = (await options.runtime.openRef(ref, {
          effects: { reads: [ref] },
        })) as FilesStoreFxHandle;
        const keys = await handle.list();
        warnings = projectFileKeys(keys).flatMap((k) => k.warnings);
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
      warnings,
    });
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
  return unique.map((childName) => {
    const effectRef = (
      facet === "sql" ? `sql:${childName}` : `${facet}:${storeName}`
    ) as ResourceRef;
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
    };
  });
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
  const cols: string[] = [];
  const tableMeta = store.tables?.[table];
  for (const [col, tags] of Object.entries(tableMeta?.columns ?? {})) {
    if (tags?.pii) cols.push(col);
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
      cols.push(key.slice(table.length + 1));
    }
  }
  return [...new Set(cols)].sort();
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
}

/** Query result shape. */
export interface StoreQueryResult {
  readonly facet: StoreFacet;
  readonly rows?: readonly Record<string, unknown>[];
  readonly keys?: ReadonlyArray<{
    readonly key: string;
    readonly value?: unknown;
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
  const handle = await runtime.openRef(input.ref, {
    effects,
    revealPii: input.revealPii === true,
  });

  if (facet === "sql") {
    const sql = handle as SqlStoreHandle;
    const table = input.child;
    if (!table) {
      return { facet, rows: [], masked: !input.revealPii, routedRole: sql.routedRole };
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
      };
    } catch {
      // Table may not exist yet — empty browse.
      return {
        facet,
        rows: [],
        masked: !input.revealPii,
        routedRole: sql.routedRole,
      };
    }
  }

  if (facet === "kv") {
    const kv = handle as KvStoreFxHandle;
    const keys = await kv.list(input.prefix ?? "");
    const limited = keys.slice(0, input.limit ?? 100);
    const entries = await Promise.all(
      limited.map(async (key) => ({
        key,
        value: await kv.get(key),
      })),
    );
    return { facet, keys: entries, masked: false };
  }

  if (facet === "files") {
    const filesHandle = handle as FilesStoreFxHandle;
    const keys = await filesHandle.list(input.prefix ?? "");
    const projected = projectFileKeys(keys.slice(0, input.limit ?? 100));
    return {
      facet,
      keys: projected.map((k) => ({
        key: k.key,
        warnings: k.warnings.map((w) => ({
          code: w.code,
          message: w.message,
        })),
      })),
      masked: false,
    };
  }

  // index
  const idx = handle as IndexStoreFxHandle;
  void manifest;
  if (idx.driverId === "meilisearch") {
    const q = input.q ?? "";
    if (q.trim().length === 0) {
      return { facet, hits: [], masked: false };
    }
    const result = await idx.search(q, { topK: input.topK ?? 5 });
    return { facet, hits: result.hits, facetDistribution: result.facetDistribution, masked: false };
  }
  const vector = input.vector ?? [];
  if (vector.length === 0) {
    return { facet, hits: [], masked: false };
  }
  const hits = await idx.search(vector, input.topK ?? 5);
  return { facet, hits, masked: false };
}

/** Options for a direct edit (not a flow execution). */
export interface StoreEditInput {
  readonly ref: ResourceRef;
  readonly child?: string;
  readonly tenant?: string;
  readonly id?: string;
  readonly key?: string;
  readonly patch: Record<string, unknown>;
  readonly confirmation?: string;
  readonly reason?: string;
  readonly confirmed?: boolean;
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
        await applyEdit(runtime, input, { revealPii: false });
      });
      await restoreEditTarget(runtime, snapshot);
      return {
        ok: true,
        dryRun: true,
        willNotFire,
        applied: false,
        wouldHaveFired,
      };
    } catch (err) {
      await restoreEditTarget(runtime, snapshot);
      if (err instanceof DryRunWriteIsolationError) {
        throw err;
      }
      throw err;
    }
  }

  await applyEdit(runtime, input, { revealPii: false });
  // Direct edit: invalidate cache for written resource (effects-derived).
  runtime.onWriteEffects({ writes: [effectRef] });
  void options.production;
  return {
    ok: true,
    dryRun: false,
    willNotFire,
    applied: true,
    wouldHaveFired: [],
  };
}

/** Snapshot of a direct-edit target for dry-run rollback. */
type EditSnapshot =
  | {
      readonly kind: "kv";
      readonly ref: ResourceRef;
      readonly key: string;
      readonly value: unknown;
    }
  | {
      readonly kind: "sql";
      readonly ref: ResourceRef;
      readonly child: string;
      readonly id: string;
      readonly row: Record<string, unknown> | null;
    }
  | { readonly kind: "none" };

async function snapshotEditTarget(
  runtime: StoreRuntime,
  input: StoreEditInput,
): Promise<EditSnapshot> {
  const [facet] = input.ref.split(":") as [StoreFacet, string];
  if (facet === "kv" && input.key) {
    const kv = (await runtime.openRef(input.ref, {
      effects: { reads: [input.ref] },
    })) as KvStoreFxHandle;
    return {
      kind: "kv",
      ref: input.ref,
      key: input.key,
      value: await kv.get(input.key),
    };
  }
  if (facet === "sql" && input.child && input.id) {
    const sql = (await runtime.openRef(input.ref, {
      effects: { reads: [input.ref] },
    })) as SqlStoreHandle;
    try {
      const rows = await sql.raw(`SELECT * FROM "${input.child}" WHERE "id" = ? LIMIT 1`, [
        input.id,
      ]);
      return {
        kind: "sql",
        ref: input.ref,
        child: input.child,
        id: input.id,
        row: rows[0] ?? null,
      };
    } catch {
      return {
        kind: "sql",
        ref: input.ref,
        child: input.child,
        id: input.id,
        row: null,
      };
    }
  }
  return { kind: "none" };
}

async function restoreEditTarget(runtime: StoreRuntime, snapshot: EditSnapshot): Promise<void> {
  if (snapshot.kind === "kv") {
    const kv = (await runtime.openRef(snapshot.ref, {
      effects: { writes: [snapshot.ref] },
    })) as KvStoreFxHandle;
    if (snapshot.value === undefined) {
      await kv.delete(snapshot.key);
    } else {
      await kv.set(snapshot.key, snapshot.value);
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

async function applyEdit(
  runtime: StoreRuntime,
  input: StoreEditInput,
  ctx: { readonly revealPii: boolean },
): Promise<void> {
  const [facet] = input.ref.split(":") as [StoreFacet, string];
  const handle = await runtime.openRef(input.ref, {
    effects: { writes: [input.ref] },
    revealPii: ctx.revealPii,
  });

  if (facet === "kv") {
    const kv = handle as KvStoreFxHandle;
    const key = input.key;
    if (!key) throw new Error("kv edit requires key");
    await kv.set(key, input.patch.value ?? input.patch);
    return;
  }

  if (facet === "sql") {
    const sql = handle as SqlStoreHandle;
    const table = input.child;
    const id = input.id;
    if (!table || !id) throw new Error("sql edit requires child + id");
    const sets = Object.keys(input.patch);
    if (sets.length === 0) return;
    const assignments = sets.map((c) => `"${c}" = ?`).join(", ");
    const params = [...sets.map((c) => input.patch[c]), id];
    await sql.raw(`UPDATE "${table}" SET ${assignments} WHERE "id" = ?`, params);
    return;
  }

  throw new Error(`direct edit not supported for facet ${facet}`);
}

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
    for (const key of input.keys ?? []) {
      if (await filesHandle.delete(key)) deleted++;
    }
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
 * Raw SQL console — read-only by default.
 *
 * @param runtime - Store runtime
 * @param ref - SQL store ref
 * @param sqlText - SQL
 * @param options - Write allow + reveal
 */
export async function runStoreSql(
  runtime: StoreRuntime,
  ref: ResourceRef,
  sqlText: string,
  options: {
    readonly allowWrite: boolean;
    readonly revealPii?: boolean;
    readonly tenant?: string;
  },
): Promise<{
  readonly rows: readonly Record<string, unknown>[];
  readonly masked: boolean;
  readonly routedRole: "primary" | "replica";
}> {
  const trimmed = sqlText.trim();
  const isWrite = /^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE)\b/i.test(trimmed);
  if (isWrite && !options.allowWrite) {
    throw new Error("SQL console is read-only by default — write requires console:store.sql:write");
  }
  const handle = (await runtime.openRef(ref, {
    effects: isWrite ? { writes: [ref] } : { reads: [ref] },
    revealPii: options.revealPii === true,
  })) as SqlStoreHandle;
  const rows = await handle.raw(trimmed);
  return {
    rows,
    masked: !options.revealPii,
    routedRole: handle.routedRole,
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
            classify: store.classifications as never,
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
  return runtime;
}
