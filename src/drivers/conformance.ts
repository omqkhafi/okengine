/**
 * Driver conformance suite — the same assertions run against every driver.
 *
 * Import {@link runSqlConformance} / {@link runKvConformance} / … from tests
 * and invoke once per protocol driver.
 */

import { expect } from "bun:test";
import { createSqlStoreHandle } from "../elements/store/sql-session.ts";
import { defineTable } from "../elements/store/table.ts";
import type { FilesDriver, IndexDriver, KvDriver, SqlDriver, SqlConnectOptions } from "./types.ts";

/** SQL conformance against one driver. */
export async function runSqlConformance(
  driver: SqlDriver,
  connect: SqlConnectOptions = {},
): Promise<void> {
  const primary = await driver.connect({ ...connect, role: "primary" });
  try {
    await primary.exec(
      `CREATE TABLE IF NOT EXISTS "notes" ("id" TEXT PRIMARY KEY, "title" TEXT, "email" TEXT)`,
    );
    const inserted = await primary.query(
      `INSERT INTO "notes" ("id", "title", "email") VALUES (?, ?, ?) RETURNING *`,
      ["n1", "hello", "a@b.c"],
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.id).toBe("n1");

    const all = await primary.query(`SELECT * FROM "notes"`);
    expect(all).toHaveLength(1);
    expect(all[0]?.title).toBe("hello");

    const one = await primary.query(`SELECT * FROM "notes" WHERE "id" = ?`, ["n1"]);
    expect(one[0]?.email).toBe("a@b.c");

    const del = await primary.exec(`DELETE FROM "notes" WHERE "id" = ?`, ["n1"]);
    expect(del.changes).toBeGreaterThan(0);
    expect(await primary.query(`SELECT * FROM "notes"`)).toHaveLength(0);
    expect(primary.driverId).toBe(driver.id);

    // Convenience helpers — every SQL driver must prove exists + atomic increment.
    await primary.exec(
      `CREATE TABLE IF NOT EXISTS "counters" ("id" TEXT PRIMARY KEY, "clicks" INTEGER)`,
    );
    await primary.query(`INSERT INTO "counters" ("id", "clicks") VALUES (?, ?) RETURNING *`, [
      "c1",
      0,
    ]);

    const handle = createSqlStoreHandle(`sql:conformance`, {
      connection: primary,
      classifications: new Map(),
      routedRole: "primary",
    });
    const counters = defineTable("counters", { id: true, clicks: true });

    expect(await handle.exists(counters, { id: "c1" })).toBe(true);
    expect(await handle.exists(counters, { id: "missing" })).toBe(false);

    const afterOne = await handle.increment(counters, "c1", "clicks");
    expect(afterOne).toBe(1);

    const concurrent = 100;
    await Promise.all(
      Array.from({ length: concurrent }, () => handle.increment(counters, "c1", "clicks")),
    );
    const finalRows = await primary.query(`SELECT * FROM "counters" WHERE "id" = ?`, ["c1"]);
    expect(Number(finalRows[0]?.clicks)).toBe(1 + concurrent);
  } finally {
    await primary.close();
  }
}

/** KV conformance against one driver. */
export async function runKvConformance(
  driver: KvDriver,
  openOpts: { name?: string; url?: string; client?: unknown } = {},
): Promise<void> {
  const ns = await driver.open({
    name: openOpts.name ?? "conformance",
    url: openOpts.url,
    client: openOpts.client as never,
  });
  try {
    await ns.set("k", { v: 1 });
    expect(await ns.get("k")).toEqual({ v: 1 });
    expect(await ns.delete("k")).toBe(true);
    expect(await ns.get("k")).toBeUndefined();
    expect(ns.driverId).toBe(driver.id);
  } finally {
    await ns.close();
  }
}

/** Files conformance against one driver. */
export async function runFilesConformance(
  driver: FilesDriver,
  openOpts: { name?: string; root?: string; client?: unknown } = {},
): Promise<void> {
  const bucket = await driver.open({
    name: openOpts.name ?? `conf-${driver.id}`,
    root: openOpts.root,
    client: openOpts.client as never,
  });
  try {
    await bucket.put("a/b.txt", "hello");
    const bytes = await bucket.get("a/b.txt");
    expect(bytes).not.toBeNull();
    expect(new TextDecoder().decode(bytes!)).toBe("hello");
    const keys = await bucket.list("a/");
    expect(keys).toContain("a/b.txt");
    expect(await bucket.delete("a/b.txt")).toBe(true);
    expect(await bucket.get("a/b.txt")).toBeNull();
    expect(bucket.driverId).toBe(driver.id);
  } finally {
    await bucket.close();
  }
}

/** Index conformance against one driver. */
export async function runIndexConformance(
  driver: IndexDriver,
  openOpts: {
    name?: string;
    dims?: number;
    url?: string;
    sql?: import("./types.ts").SqlConnection;
  } = {},
): Promise<void> {
  const dims = openOpts.dims ?? 3;
  const index = await driver.open({
    name: openOpts.name ?? "conf",
    dims,
    url: openOpts.url,
    sql: openOpts.sql,
  });
  try {
    await index.upsert("d1", [1, 0, 0], { t: 1 });
    await index.upsert("d2", [0.9, 0.1, 0]);
    const hits = await index.search([1, 0, 0], 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBe("d1");
    expect(await index.delete("d1")).toBe(true);
    expect(index.driverId).toBe(driver.id);
  } finally {
    await index.close();
  }
}
