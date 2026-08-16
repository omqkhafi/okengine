/**
 * DuckDB peer is a real runtime dependency — open must succeed here
 * (and in scaffolded apps after `bun add @duckdb/node-api`).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { duckQuery, openDuckDB } from "./duckdb.ts";

describe("openDuckDB", () => {
  test("opens an in-memory session and runs SQL", async () => {
    const session = await openDuckDB();
    try {
      const rows = await duckQuery(session.conn, "SELECT 1 AS n");
      expect(Number(rows[0]?.n)).toBe(1);
    } finally {
      session.close();
    }
  });

  test("both create-oke templates declare @duckdb/node-api", () => {
    const root = join(import.meta.dir, "../../packages/create-oke/templates");
    for (const tier of ["standard", "advanced"] as const) {
      const pkg = JSON.parse(readFileSync(join(root, tier, "package.json"), "utf8")) as {
        dependencies?: { "@duckdb/node-api"?: string };
      };
      expect(pkg.dependencies?.["@duckdb/node-api"]).toMatch(/^\^1\.5\./);
    }
  });
});
