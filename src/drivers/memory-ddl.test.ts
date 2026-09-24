/**
 * Memory SQL accepts the DDL identity boot issues on the shared connection.
 */

import { describe, expect, test } from "bun:test";
import { ensureIdentityTables } from "../auth/identity-sql.ts";
import { memorySqlDriver } from "./memory.ts";

describe("memory sql DDL", () => {
  test("CREATE INDEX IF NOT EXISTS does not reject identity tables", async () => {
    const conn = await memorySqlDriver.connect({ role: "primary" });
    await ensureIdentityTables(conn);
    await ensureIdentityTables(conn);
    const rows = await conn.query("SELECT id FROM oke_credentials");
    expect(rows).toEqual([]);
    await conn.close();
  });
});
