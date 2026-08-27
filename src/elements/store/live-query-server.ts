/**
 * LiveQuery server leg — binds {@link LiveQueryRuntime} to a real
 * {@link SqlConnection} on Postgres-capable drivers.
 *
 * Probes run through the subscriber's stamped identity using the SAME
 * production path as reads: RLS prelude (`SET LOCAL ROLE oke_app` + GUCs)
 * pinned inside one `SqlConnection.transaction` frame. Replay checks use
 * `oke.row_passes_policies`, installed alongside the other `oke.*` helpers
 * at first stamped write.
 */

import {
  buildRlsIdentityPreludeSql,
  ROW_PASSES_POLICIES_STATEMENTS,
  type RlsIdentity,
} from "../../drivers/pg-rls.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import {
  LiveQueryRuntime,
  type LiveProbeExec,
  type LiveProbeRunner,
} from "./live-query-runtime.ts";

/** One `oke.row_passes_policies` install per connection. */
const rowPassesInstalls = new WeakMap<SqlConnection, Promise<void>>();

/**
 * Ensure `oke.row_passes_policies` exists on this connection.
 *
 * @param conn - Primary SQL connection
 */
export async function ensureRowPassesPolicies(conn: SqlConnection): Promise<void> {
  let installing = rowPassesInstalls.get(conn);
  if (!installing) {
    installing = (async () => {
      for (const stmt of ROW_PASSES_POLICIES_STATEMENTS) {
        await conn.exec(stmt);
      }
    })().catch((err) => {
      rowPassesInstalls.delete(conn);
      throw err;
    });
    rowPassesInstalls.set(conn, installing);
  }
  await installing;
}

/**
 * Probe runner over one connection.
 *
 * PGlite is a single backend session — concurrent identity frames are
 * serialized exactly like the write path (`rlsStampTails`). Pooled postgres
 * pins each frame with `transaction()`.
 *
 * @param conn - SQL connection shared with the store runtime
 */
export function createConnProbeRunner(conn: SqlConnection): LiveProbeRunner {
  const tails = new WeakMap<SqlConnection, Promise<unknown>>();
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const prev = tails.get(conn) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(run);
    tails.set(
      conn,
      next.catch(() => undefined),
    );
    return next;
  };
  return {
    async runStamped<T>(
      identity: RlsIdentity,
      fn: (exec: LiveProbeExec) => Promise<T>,
    ): Promise<T> {
      await ensureRowPassesPolicies(conn);
      const frame = async (tx: SqlConnection): Promise<T> => {
        for (const stmt of buildRlsIdentityPreludeSql(identity)) {
          await tx.exec(stmt.sql, stmt.params ?? []);
        }
        return fn({ query: (sql, params) => tx.query(sql, params) });
      };
      if (!conn.transaction) {
        throw new Error("live probes need SqlConnection.transaction to pin SET LOCAL");
      }
      if (conn.driverId === "pglite") {
        return serialize(() => conn.transaction!(frame));
      }
      return conn.transaction(frame);
    },
  };
}

/**
 * Build the boot-time runtime wired to a primary connection.
 *
 * @param conn - Shared primary SQL connection (postgres / pglite)
 * @param options - Pool knobs forwarded to {@link LiveQueryRuntime}
 */
export function liveQueryRuntimeFromConn(
  conn: SqlConnection,
  options?: ConstructorParameters<typeof LiveQueryRuntime>[1],
): LiveQueryRuntime {
  return new LiveQueryRuntime(createConnProbeRunner(conn), options);
}
