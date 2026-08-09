/**
 * Unit tests for Vault SQL resilience (retry / no-retry).
 */

import { describe, expect, test } from "bun:test";
import {
  createResilientSqlExec,
  DEFAULT_RETRY,
  isRetryableError,
  withResilience,
  type RetryConfig,
} from "./resilience.ts";
import type { SqlExec } from "./storage.ts";

const FAST: RetryConfig = {
  ...DEFAULT_RETRY,
  baseDelayMs: 1,
  maxDelayMs: 2,
};

describe("isRetryableError", () => {
  test("matches known connection codes", () => {
    expect(isRetryableError({ code: "ECONNRESET" })).toBe(true);
    expect(isRetryableError({ code: "08006" })).toBe(true);
    expect(isRetryableError(new Error("connect ETIMEDOUT"))).toBe(true);
  });

  test("rejects business / unknown errors", () => {
    expect(isRetryableError(new Error("INVALID_PATH"))).toBe(false);
    expect(isRetryableError({ code: "42P01" })).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });
});

describe("withResilience", () => {
  test("retries retryable failures then succeeds", async () => {
    let attempts = 0;
    const value = await withResilience(async () => {
      attempts += 1;
      if (attempts < 3) {
        const err = new Error("connection reset");
        (err as { code?: string }).code = "ECONNRESET";
        throw err;
      }
      return "ok";
    }, FAST);
    expect(value).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("exhausts retries then fails", async () => {
    let attempts = 0;
    await expect(
      withResilience(
        async () => {
          attempts += 1;
          const err = new Error("gone");
          (err as { code?: string }).code = "57P01";
          throw err;
        },
        { ...FAST, maxRetries: 3 },
      ),
    ).rejects.toMatchObject({ code: "57P01" });
    // First try + 3 retries.
    expect(attempts).toBe(4);
  });

  test("non-retryable errors fail immediately", async () => {
    let attempts = 0;
    await expect(
      withResilience(async () => {
        attempts += 1;
        throw new Error("INVALID_PATH");
      }, FAST),
    ).rejects.toThrow("INVALID_PATH");
    expect(attempts).toBe(1);
  });
});

describe("createResilientSqlExec", () => {
  test("wraps query with the same retry policy", async () => {
    let attempts = 0;
    const raw: SqlExec = {
      async query<T>() {
        attempts += 1;
        if (attempts === 1) {
          const err = new Error("blip");
          (err as { code?: string }).code = "ETIMEDOUT";
          throw err;
        }
        return [{ id: 1 }] as T[];
      },
      async execute() {
        /* unused */
      },
    };
    const db = createResilientSqlExec(raw, FAST);
    const rows = await db.query<{ id: number }>("SELECT 1");
    expect(rows).toEqual([{ id: 1 }]);
    expect(attempts).toBe(2);
  });
});
