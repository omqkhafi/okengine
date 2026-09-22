/**
 * Driver-backed `fx.store` SQL handle — lazy chunk.
 *
 * The in-memory stub stays on the edge profile. This query builder loads
 * the first time a SQL facet is opened.
 */

import type { SqlRow } from "../drivers/types.ts";
import type {
  SelectFromBuilder,
  SelectOrderBuilder,
  SqlStoreHandle,
  StoreDecl,
} from "../elements/store.ts";
import { schemaTableName, sqlTableRef } from "../manifest/sql-resource.ts";
import type { CapabilityToken } from "./capability.ts";
import { DryRunWriteIsolationError, isDryRun } from "./dry-run.ts";
import type { EffectExternal } from "./effects.ts";

/** Capability-gated effect runner from {@link createFx}. */
type Gated = <T>(
  kind: Parameters<CapabilityToken["assert"]>[0],
  resource: string,
  body: () => T | Promise<T>,
  externalOf?:
    | EffectExternal
    | ((result: T | undefined, error: unknown) => EffectExternal | undefined),
) => Promise<T>;

/** Inputs for {@link createGatedSqlHandle}. */
export interface GatedSqlHandleOptions {
  /** Store declaration (`facet: "sql"`). */
  readonly decl: StoreDecl;
  /** Opens (and caches) the runtime handle. */
  readonly open: () => Promise<SqlStoreHandle>;
  /** Flow `gated` helper. */
  readonly gated: Gated;
  /** Capability token for per-table ref checks. */
  readonly capability: CapabilityToken;
  /** `fx.ask` — optional search rerank. */
  readonly ask: (model: string, input: unknown) => Promise<unknown>;
}

/**
 * Lazy, capability-gated proxy over a driver-backed {@link SqlStoreHandle}.
 *
 * @param options - Declaration, opener, gate, and rerank hook
 */
export function createGatedSqlHandle(options: GatedSqlHandleOptions): SqlStoreHandle {
  const { decl, open, gated, capability, ask } = options;
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
   * call site); falls back to the store-level ref when the table ref isn't
   * declared — flows that hand-declared `effects: { writes: ["sql:<store>"] }`
   * keep working. Ledger / journal record whichever ref the capability check
   * actually matched.
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
    const externalOf = (): EffectExternal | undefined => cached?.external;
    const name = schemaTableName(table);
    if (name !== undefined) {
      const perTable = sqlTableRef(name);
      if (perTable !== ref && capability.allows(kind, perTable)) {
        return gated(kind, perTable, body, externalOf);
      }
    }
    return gated(kind, ref, body, externalOf);
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
    search(table, searchOptions) {
      return gatedTable("read", table, async () => {
        const h = await ensure();
        const result = await h.search(table, searchOptions);
        // Optional rerank via fx.ask — only when explicitly requested.
        if (
          searchOptions.rerank &&
          typeof searchOptions.rerank === "object" &&
          searchOptions.rerank.model
        ) {
          const model = searchOptions.rerank.model;
          const pk = "id";
          const docs = result.data.map((row) => ({
            id: String(row[pk] ?? ""),
            text: Object.values(row)
              .filter((v) => typeof v === "string")
              .join("\n"),
            score: 0,
          }));
          const out = (await ask(model, {
            query: searchOptions.query,
            docs,
          })) as { rankedIds?: string[] };
          if (out.rankedIds && out.rankedIds.length > 0) {
            const byId = new Map(result.data.map((r) => [String(r[pk] ?? ""), r]));
            return {
              ...result,
              data: out.rankedIds
                .map((id) => byId.get(id))
                .filter((r): r is NonNullable<typeof r> => r !== undefined),
            };
          }
        }
        return result;
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
