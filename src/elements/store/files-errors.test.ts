/**
 * `fs` / `s3` files errors → Forbidden / ServiceUnavailable.
 */

import { describe, expect, test } from "bun:test";
import { isFlowFailure } from "../../kernel/hooks.ts";
import { createS3FakeClient, s3Driver } from "../../drivers/s3.ts";
import { fsDriver } from "../../drivers/fs.ts";
import { memoryDrivers } from "../../drivers/memory.ts";
import { store } from "./declare.ts";
import { filesErrorToFailure, isRetryableFilesError } from "./files-errors.ts";
import { createStoreRuntime, type FilesStoreFxHandle } from "./runtime.ts";

describe("filesErrorToFailure", () => {
  test("AccessDenied / EACCES → Forbidden without copying message", () => {
    const denied = filesErrorToFailure(
      Object.assign(new Error("Access Denied"), { code: "AccessDenied", status: 403 }),
    );
    expect(denied?.error.code).toBe("Forbidden");
    expect(JSON.stringify(denied)).not.toContain("Access Denied");

    expect(
      filesErrorToFailure(Object.assign(new Error("permission denied"), { code: "EACCES" }))?.error
        .code,
    ).toBe("Forbidden");
    expect(isFlowFailure(denied)).toBe(true);
  });

  test("Invalid object key → Forbidden without copying the key", () => {
    const mapped = filesErrorToFailure(new Error("Invalid object key: ../secret"));
    expect(mapped?.error.code).toBe("Forbidden");
    expect(mapped?.error.data).toMatchObject({ reason: "invalid_key" });
    expect(JSON.stringify(mapped)).not.toContain("../secret");
  });

  test("NoSuchBucket / ENOSPC / connection → ServiceUnavailable", () => {
    expect(filesErrorToFailure(new Error("The specified bucket does not exist"))?.error.code).toBe(
      "ServiceUnavailable",
    );
    expect(
      filesErrorToFailure(Object.assign(new Error("No space left on device"), { code: "ENOSPC" }))
        ?.error.code,
    ).toBe("ServiceUnavailable");
    expect(
      filesErrorToFailure(
        Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
      )?.error.code,
    ).toBe("ServiceUnavailable");
    expect(
      JSON.stringify(filesErrorToFailure(new Error("The specified bucket does not exist"))),
    ).not.toContain("specified bucket");
  });

  test("SlowDown / EBUSY left thrown until retryable: unavailable", () => {
    const slow = Object.assign(new Error("Please reduce your request rate"), { code: "SlowDown" });
    expect(isRetryableFilesError(slow)).toBe(true);
    expect(filesErrorToFailure(slow, { retryable: "leave" })).toBeUndefined();
    expect(filesErrorToFailure(slow, { retryable: "unavailable" })?.error.code).toBe(
      "ServiceUnavailable",
    );
    expect(
      filesErrorToFailure(Object.assign(new Error("resource busy"), { code: "EBUSY" }), {
        retryable: "leave",
      }),
    ).toBeUndefined();
  });

  test("NoSuchKey and generic throws stay unmapped", () => {
    expect(
      filesErrorToFailure(
        Object.assign(new Error("The specified key does not exist"), { code: "NoSuchKey" }),
      ),
    ).toBeUndefined();
    expect(filesErrorToFailure(new Error("boom"))).toBeUndefined();
  });

  test("walks .cause and S3 XML Code", () => {
    const wrapped = {
      message: "put failed",
      cause: new Error("<?xml><Error><Code>AccessDenied</Code></Error>"),
    };
    expect(filesErrorToFailure(wrapped)?.error.code).toBe("Forbidden");
    expect(JSON.stringify(filesErrorToFailure(wrapped))).not.toContain("put failed");
  });
});

describe("openFiles maps S3 throws", () => {
  test("AccessDenied on put becomes Forbidden", async () => {
    const fake = createS3FakeClient();
    const inner = fake.file.bind(fake);
    fake.file = (key: string) => {
      const file = inner(key);
      return {
        ...file,
        write: async () => {
          throw Object.assign(new Error("Access Denied"), { code: "AccessDenied", status: 403 });
        },
      };
    };
    const uploads = store.files("uploads");
    const runtime = createStoreRuntime({
      drivers: {
        files: s3Driver,
        kv: memoryDrivers.kv,
        index: memoryDrivers.index,
      },
      files: { uploads: { client: fake } },
    });
    runtime.register(uploads);
    const handle = (await runtime.open(uploads, { effects: {} })) as FilesStoreFxHandle;
    try {
      await handle.put("a.bin", new Uint8Array([1]));
      throw new Error("expected mapped failure");
    } catch (err) {
      expect(isFlowFailure(err)).toBe(true);
      expect((err as { error: { code: string } }).error.code).toBe("Forbidden");
      expect(JSON.stringify(err)).not.toContain("Access Denied");
    }
    await runtime.close();
  });

  test("fs path-escape key becomes Forbidden", async () => {
    const uploads = store.files("escapes");
    const runtime = createStoreRuntime({
      drivers: {
        files: fsDriver,
        kv: memoryDrivers.kv,
        index: memoryDrivers.index,
      },
      files: { escapes: { root: `${process.env.TMPDIR ?? "/tmp"}/oke-files-escape` } },
    });
    runtime.register(uploads);
    const handle = (await runtime.open(uploads, { effects: {} })) as FilesStoreFxHandle;
    try {
      await handle.put("../secret", "x");
      throw new Error("expected mapped failure");
    } catch (err) {
      expect(isFlowFailure(err)).toBe(true);
      expect((err as { error: { code: string; data?: { reason?: string } } }).error.code).toBe(
        "Forbidden",
      );
      expect((err as { error: { data?: { reason?: string } } }).error.data?.reason).toBe(
        "invalid_key",
      );
      expect(JSON.stringify(err)).not.toContain("../secret");
    }
    await runtime.close();
  });
});
