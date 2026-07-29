/**
 * Map OKE `store.sql` driver ids to drizzle-kit dialects.
 *
 * drizzle-kit `1.0.0-rc.4` dialects (from its schema validator):
 * `postgresql` · `mysql` · `sqlite` · `turso` · `singlestore` · `mssql` ·
 * `cockroach` · `duckdb`. OKE owns kit-facing SQL drivers `sqlite` /
 * `postgres` only — map those, never infer from connection URLs.
 */

import type { StoreDriverId } from "./types.ts";

/** drizzle-kit `Dialect` values OKE currently emits for owned SQL drivers. */
export type OkeDrizzleKitDialect = "sqlite" | "postgresql";

/**
 * Exhaustive map: adding a new SQL id to `StoreDriverId` without updating
 * this `Record` is a compile error (via `Extract`), not a silent wrong
 * dialect months later.
 */
export const SQL_DRIVER_TO_DRIZZLE_DIALECT: Record<
  Extract<StoreDriverId, "sqlite" | "postgres">,
  OkeDrizzleKitDialect
> = {
  sqlite: "sqlite",
  postgres: "postgresql",
};

/**
 * Resolve the drizzle-kit dialect for an OKE SQL driver id.
 *
 * @param driverId - Protocol driver id (`sqlite` | `postgres`)
 */
export function drizzleDialectFromSqlDriver(
  driverId: Extract<StoreDriverId, "sqlite" | "postgres">,
): OkeDrizzleKitDialect {
  return SQL_DRIVER_TO_DRIZZLE_DIALECT[driverId];
}
