/**
 * Redis-wire KV errors → ServiceUnavailable (availability / retry exhaust).
 */

import { describe, expect, test } from "bun:test";
import { isFlowFailure } from "../../kernel/hooks.ts";
import { createRedisFakeClient, redisDriver } from "../../drivers/redis.ts";
import { memoryDrivers } from "../../drivers/memory.ts";
import { store } from "./declare.ts";
import { isRetryableKvError, kvErrorToFailure } from "./kv-errors.ts";
import { createStoreRuntime, type KvStoreFxHandle } from "./runtime.ts";

describe("kvErrorToFailure", () => {
  test("connection / cluster → ServiceUnavailable without copying message", () => {
    const closed = kvErrorToFailure(
      Object.assign(new Error("Connection closed"), { code: "ECONNREFUSED" }),
    );
    expect(closed?.error.code).toBe("ServiceUnavailable");
    expect(JSON.stringify(closed)).not.toContain("Connection closed");

    expect(kvErrorToFailure(new Error("CLUSTERDOWN The cluster is down"))?.error.code).toBe(
      "ServiceUnavailable",
    );
    expect(
      kvErrorToFailure(new Error("READONLY You can't write against a read only replica."))?.error
        .code,
    ).toBe("ServiceUnavailable");
    expect(
      kvErrorToFailure(new Error("OOM command not allowed when used memory > 'maxmemory'."))?.error
        .code,
    ).toBe("ServiceUnavailable");
    expect(isFlowFailure(closed)).toBe(true);
  });

  test("BUSY / TRYAGAIN left thrown until retryable: unavailable", () => {
    const busy = new Error("BUSY Redis is busy running a script");
    expect(isRetryableKvError(busy)).toBe(true);
    expect(kvErrorToFailure(busy, { retryable: "leave" })).toBeUndefined();
    expect(kvErrorToFailure(busy, { retryable: "unavailable" })?.error.code).toBe(
      "ServiceUnavailable",
    );
    expect(
      kvErrorToFailure(new Error("TRYAGAIN Multiple keys request during rehashing"), {
        retryable: "leave",
      }),
    ).toBeUndefined();
  });

  test("WRONGTYPE / NOSCRIPT stay unmapped", () => {
    expect(
      kvErrorToFailure(
        new Error("WRONGTYPE Operation against a key holding the wrong kind of value"),
      ),
    ).toBeUndefined();
    expect(
      kvErrorToFailure(new Error("NOSCRIPT No matching script. Please use EVAL.")),
    ).toBeUndefined();
    expect(kvErrorToFailure(new Error("boom"))).toBeUndefined();
  });

  test("walks .cause for connection failures", () => {
    const wrapped = {
      message: "kv get failed",
      cause: Object.assign(new Error("Connection closed"), { code: "ECONNRESET" }),
    };
    expect(kvErrorToFailure(wrapped)?.error.code).toBe("ServiceUnavailable");
    expect(JSON.stringify(kvErrorToFailure(wrapped))).not.toContain("kv get failed");
  });
});

describe("openKv maps Redis throws", () => {
  test("connection failure on get becomes ServiceUnavailable", async () => {
    const fake = createRedisFakeClient();
    fake.get = async () => {
      throw Object.assign(new Error("Connection closed"), { code: "ECONNREFUSED" });
    };
    const sessions = store.kv("sessions");
    const runtime = createStoreRuntime({
      drivers: {
        kv: redisDriver,
        files: memoryDrivers.files,
        index: memoryDrivers.index,
      },
      kv: { sessions: { client: fake } },
    });
    runtime.register(sessions);
    const handle = (await runtime.open(sessions, { effects: {} })) as KvStoreFxHandle;
    try {
      await handle.get("sid");
      throw new Error("expected mapped failure");
    } catch (err) {
      expect(isFlowFailure(err)).toBe(true);
      expect((err as { error: { code: string } }).error.code).toBe("ServiceUnavailable");
      expect(JSON.stringify(err)).not.toContain("Connection closed");
    }
    await runtime.close();
  });
});
