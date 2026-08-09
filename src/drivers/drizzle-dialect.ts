/**
 * Map OKE `store.sql` driver ids to drizzle-kit dialects.
 *
 * Owned SQL drivers are Postgres-family only (`postgres` · `pglite`) — both
 * map to kit dialect `postgresql`. Never infer from connection URLs.
 */

import type { StoreDriverId } from "./types.ts";

/** drizzle-kit `Dialect` values OKE emits for owned SQL drivers. */
export type OkeDrizzleKitDialect = "postgresql";

/**
 * Exhaustive map: adding a new SQL id to `StoreDriverId` without updating
 * this `Record` is a compile error (via `Extract`), not a silent wrong
 * dialect months later.
 */
export const SQL_DRIVER_TO_DRIZZLE_DIALECT: Record<
  Extract<StoreDriverId, "postgres" | "pglite">,
  OkeDrizzleKitDialect
> = {
  postgres: "postgresql",
  pglite: "postgresql",
};

/**
 * Resolve the drizzle-kit dialect for an OKE SQL driver id.
 *
 * @param driverId - Protocol driver id (`postgres` | `pglite`)
 */
export function drizzleDialectFromSqlDriver(
  driverId: Extract<StoreDriverId, "postgres" | "pglite">,
): OkeDrizzleKitDialect {
  return SQL_DRIVER_TO_DRIZZLE_DIALECT[driverId];
}
