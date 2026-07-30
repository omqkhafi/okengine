/**
 * `configSource()` — runtime-mutable plugin configuration: code as the
 * floor, DB as the source of truth, KV as the automatic read-through cache.
 *
 * Hooks cannot touch stores (fx is capability-gated per flow), so plugins
 * resolve config synchronously from an in-memory box. A real flow — bound
 * by the app on a clock trigger, with declared effects — refreshes that
 * box: KV hit → box; miss → DB row → box + KV write-back. Every world
 * access stays inside a flow, per the fx rule.
 */

import type { KvStoreDecl, SqlStoreDecl } from "../elements/store/declare.ts";
import type { KvStoreFxHandle } from "../elements/store/runtime.ts";
import { field } from "../elements/store/schema-decl.ts";
import type { SqlStoreHandle } from "../elements/store/sql-session.ts";
import { flow, type AnyFlowDef } from "../kernel/flow.ts";
import type { PluginDef } from "../kernel/plugin.ts";

/** Resource refs a config sync flow may touch. */
type StoreRef = `kv:${string}` | `sql:${string}`;

const configSourceBrand: unique symbol = Symbol("oke.configSource");

/** DB side of a {@link ConfigSource}. */
export interface ConfigSourceDb {
  /** `store.sql` binding owned by the app. */
  readonly store: SqlStoreDecl;
  /**
   * Config table name. Default `<plugin-id>_config` (kebab → snake). The
   * owning plugin contributes this table (`oke db push` creates it).
   */
  readonly table?: string;
}

/** Options for {@link configSource}. */
export interface ConfigSourceOptions<T extends object> {
  /**
   * Plugin id this config belongs to (e.g. `"security-headers"`) — derives
   * the DB row key, the KV key, and the default table name.
   */
  readonly plugin: string;
  /**
   * Base config in code — always present, always the floor. DB values are
   * shallow-merged over it; a missing DB row means exactly this.
   */
  readonly code: T;
  /** DB source of truth (optional). Values override `code`. */
  readonly db?: ConfigSourceDb;
  /**
   * KV binding for the automatic read-through cache (optional). When set,
   * DB values are cached with `ttl` so steady-state sync ticks never touch
   * the database.
   */
  readonly kv?: KvStoreDecl;
  /** KV TTL for cached DB values. Default `"30s"`. */
  readonly ttl?: string;
}

/**
 * A live config box for one plugin. `current()` is synchronous and never
 * throws — safe to read from any hook. `sync()` is the refresh flow the
 * app binds once: `on(every("30s"), source.sync())`.
 */
export interface ConfigSource<T extends object> {
  readonly [configSourceBrand]: true;
  /** Plugin id. */
  readonly plugin: string;
  /** The static `code` config — used as the plugin identity snapshot. */
  readonly codeConfig: T;
  /** Config table name when DB-backed (the owning plugin contributes it). */
  readonly table?: string;
  /** Current merged config (code ← DB overrides). */
  current(): T;
  /** Refresh flow — bind once on a clock trigger. */
  sync(): AnyFlowDef;
}

/** Row key of the single config row inside a plugin's config table. */
const ROW_KEY = "config";

/** kebab-case plugin id → snake_case default table name. */
function defaultTable(plugin: string): string {
  return `${plugin.replace(/-/g, "_")}_config`;
}

/** Shallow merge — DB partial wins over code, key by key. */
function mergeConfig<T extends object>(code: T, partial: unknown): T {
  if (typeof partial !== "object" || partial === null || Array.isArray(partial)) return code;
  return { ...code, ...(partial as Partial<T>) };
}

/**
 * Create a code-or-DB config source for a plugin.
 *
 * @param options - Plugin id, code floor, optional DB + KV
 */
export function configSource<T extends object>(options: ConfigSourceOptions<T>): ConfigSource<T> {
  const table =
    options.db === undefined ? undefined : (options.db.table ?? defaultTable(options.plugin));
  const kvKey = `oke:plugin-config:${options.plugin}`;
  const ttl = options.ttl ?? "30s";
  let box: T = options.code;

  const source: ConfigSource<T> = {
    [configSourceBrand]: true,
    plugin: options.plugin,
    codeConfig: options.code,
    ...(table !== undefined ? { table } : {}),
    current: () => box,
    sync() {
      const reads: StoreRef[] = [];
      const writes: StoreRef[] = [];
      if (options.kv !== undefined) {
        reads.push(options.kv.ref);
        writes.push(options.kv.ref);
      }
      if (options.db !== undefined) reads.push(options.db.store.ref);

      return flow({
        name: `${options.plugin}.config-sync`,
        effects: { reads, writes },
        do: async (_input, fx) => {
          if (options.kv !== undefined) {
            const kv = fx.store(options.kv) as KvStoreFxHandle;
            const cached = await kv.get(kvKey);
            if (cached !== undefined && cached !== null) {
              box = mergeConfig(options.code, cached);
              return { source: "kv" };
            }
          }

          if (options.db !== undefined && table !== undefined) {
            const db = fx.store(options.db.store) as SqlStoreHandle;
            const rows = await db.raw(`SELECT "value" FROM "${table}" WHERE "key" = ?`, [ROW_KEY]);
            const raw = rows[0]?.["value"];
            let partial: unknown = undefined;
            if (raw !== undefined && raw !== null) {
              if (typeof raw !== "string") {
                throw new Error(
                  `configSource(${options.plugin}): row "value" must be JSON text, got ${typeof raw}`,
                );
              }
              try {
                partial = JSON.parse(raw);
              } catch (cause) {
                throw new Error(
                  `configSource(${options.plugin}): config row is not valid JSON — ${String(cause)}`,
                );
              }
            }
            box = mergeConfig(options.code, partial);
            if (options.kv !== undefined) {
              const kv = fx.store(options.kv) as KvStoreFxHandle;
              await kv.set(kvKey, partial ?? {}, ttl);
            }
            return { source: partial === undefined ? "code" : "db" };
          }

          box = options.code;
          return { source: "code" };
        },
      });
    },
  };

  return source;
}

/** Type guard for {@link ConfigSource}. */
export function isConfigSource<T extends object>(value: unknown): value is ConfigSource<T> {
  return typeof value === "object" && value !== null && configSourceBrand in value;
}

/**
 * Resolve plugin options at request time — static options as-is, a
 * ConfigSource through its current merged value.
 *
 * @param value - Options or source
 */
export function resolvePluginOptions<T extends object>(value: T | ConfigSource<T>): T {
  return isConfigSource<T>(value) ? value.current() : value;
}

/**
 * Identity snapshot for `plugin(name, { config })` — always the static
 * code config, so DB edits never trigger false conflict errors.
 *
 * @param value - Options or source
 */
export function pluginConfigSnapshot<T extends object>(value: T | ConfigSource<T>): T {
  return isConfigSource<T>(value) ? value.codeConfig : value;
}

/**
 * Contribute the plugin's config table when its options are a DB-backed
 * ConfigSource. Chain last on the builder.
 *
 * @param def - Plugin builder
 * @param value - Options or source passed to the factory
 */
export function withConfigTable<D extends PluginDef>(def: D, value: unknown): D {
  if (isConfigSource(value) && value.table !== undefined) {
    def.table(value.table, {
      key: field.text().primaryKey(),
      value: field.text().notNull(),
    });
  }
  return def;
}
