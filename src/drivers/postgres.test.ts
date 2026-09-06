/**
 * Postgres placeholder conversion + shared pool lifecycle.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  closeSharedPostgresClients,
  connectPostgres,
  isPostgresConnectionNoise,
  isSharedPostgresPaused,
  pauseSharedPostgresClients,
  resumeSharedPostgresClients,
  SharedPostgresPausedError,
  sharedPostgresClient,
  toPostgresParams,
} from "./postgres.ts";

afterEach(async () => {
  resumeSharedPostgresClients();
  await closeSharedPostgresClients();
});

describe("toPostgresParams", () => {
  test("rewrites ? only when values are bound", () => {
    expect(toPostgresParams("SELECT * FROM t WHERE id = ?", ["a"])).toBe(
      "SELECT * FROM t WHERE id = $1",
    );
    expect(toPostgresParams("INSERT INTO t (a, b) VALUES (?, ?)", [1, 2])).toBe(
      "INSERT INTO t (a, b) VALUES ($1, $2)",
    );
  });

  test("leaves jsonb ? operators unchanged when there are no values", () => {
    const sql = "SELECT current_setting('oke.scopes', true)::jsonb ? p_scope";
    expect(toPostgresParams(sql)).toBe(sql);
    expect(toPostgresParams(sql, [])).toBe(sql);
  });
});

describe("closeSharedPostgresClients", () => {
  test("drops cached pools so the next checkout is a new client", async () => {
    const url = "postgres://127.0.0.1:9/oke-close-shared-test";
    const first = sharedPostgresClient(url);
    expect(sharedPostgresClient(url)).toBe(first);
    await closeSharedPostgresClients();
    const second = sharedPostgresClient(url);
    expect(second).not.toBe(first);
  });

  test("holder close is a no-op so seed stop cannot leave a dead cached pool", async () => {
    const url = "postgres://127.0.0.1:9/oke-holder-close-shared-test";
    const first = sharedPostgresClient(url);
    await first.close?.({ timeout: 1 });
    // Same live pool — journal/instances close during in-process seed must not
    // tear Bun.SQL while the map still hands out this client.
    expect(sharedPostgresClient(url)).toBe(first);
    await expect(first.close?.({ timeout: 1 })).resolves.toBeUndefined();
  });
});

describe("pauseSharedPostgresClients", () => {
  test("blocks new pools and fails soft on existing wrappers", async () => {
    const url = "postgres://127.0.0.1:9/oke-pause-shared-test";
    const sql = await connectPostgres({ url });
    const held = sharedPostgresClient(url);
    await pauseSharedPostgresClients();
    expect(isSharedPostgresPaused()).toBe(true);
    expect(() => sharedPostgresClient(url)).toThrow(SharedPostgresPausedError);
    await expect(sql.query("SELECT 1")).rejects.toBeInstanceOf(SharedPostgresPausedError);
    // Fleet wrappers (journal / clock / instances) call .unsafe on the held client.
    expect(() => held.unsafe("SELECT 1")).toThrow(SharedPostgresPausedError);
    resumeSharedPostgresClients();
    expect(isSharedPostgresPaused()).toBe(false);
    const next = sharedPostgresClient(url);
    expect(next).toBeDefined();
  });

  test("isPostgresConnectionNoise matches Bun close / refuse codes", () => {
    expect(
      isPostgresConnectionNoise({
        code: "ERR_POSTGRES_CONNECTION_CLOSED",
        message: "Connection closed",
      }),
    ).toBe(true);
    expect(
      isPostgresConnectionNoise({
        code: "ERR_POSTGRES_CONNECTION_REFUSED",
        message: "Failed to connect",
      }),
    ).toBe(true);
    expect(isPostgresConnectionNoise(new SharedPostgresPausedError())).toBe(true);
    expect(isPostgresConnectionNoise(new Error("relation missing"))).toBe(false);
  });
});