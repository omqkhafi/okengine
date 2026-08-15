import { describe, expect, test } from "bun:test";
import {
  EMPTY_SHA256,
  ensureS3Bucket,
  hostHeader,
  isMissingS3BucketError,
  isS3BucketAlreadyExists,
  signS3PutBucket,
} from "./s3-ensure-bucket.ts";
import { openS3Bucket, createS3FakeClient } from "./s3.ts";

describe("s3 ensure bucket", () => {
  test("detects RustFS missing-bucket copy", () => {
    expect(isMissingS3BucketError(new Error("The specified bucket does not exist"))).toBe(true);
    expect(isMissingS3BucketError(new Error("NoSuchBucket"))).toBe(true);
    expect(isMissingS3BucketError(new Error("access denied"))).toBe(false);
  });

  test("treats already-exists as success", () => {
    expect(isS3BucketAlreadyExists(200, "")).toBe(true);
    expect(isS3BucketAlreadyExists(409, "")).toBe(true);
    expect(isS3BucketAlreadyExists(400, "<Code>BucketAlreadyOwnedByYou</Code>")).toBe(true);
    expect(isS3BucketAlreadyExists(403, "AccessDenied")).toBe(false);
  });

  test("signs PUT /oke with a stable Authorization", () => {
    const headers = signS3PutBucket({
      bucket: "oke",
      host: "127.0.0.1:18850",
      accessKeyId: "AKIA",
      secretAccessKey: "secret",
      region: "us-east-1",
      now: new Date("2026-08-15T11:46:00.000Z"),
    });
    expect(headers["x-amz-content-sha256"]).toBe(EMPTY_SHA256);
    expect(headers["x-amz-date"]).toBe("20260815T114600Z");
    expect(headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIA\/20260815\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(
      signS3PutBucket({
        bucket: "oke",
        host: "127.0.0.1:18850",
        accessKeyId: "AKIA",
        secretAccessKey: "secret",
        region: "us-east-1",
        now: new Date("2026-08-15T11:46:00.000Z"),
      }).Authorization,
    ).toBe(headers.Authorization);
  });

  test("ensureS3Bucket PUTs and ignores 409", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    await ensureS3Bucket({
      bucket: "oke",
      endpoint: "http://127.0.0.1:18850",
      accessKeyId: "AKIA",
      secretAccessKey: "secret",
      now: new Date("2026-08-15T11:46:00.000Z"),
      fetch: (async (input: string | URL, init?: RequestInit) => {
        calls.push({ url: String(input), method: String(init?.method) });
        return new Response("", { status: 409 });
      }) as typeof fetch,
    });
    expect(calls).toEqual([{ url: "http://127.0.0.1:18850/oke", method: "PUT" }]);
    expect(hostHeader("http://127.0.0.1:18850")).toBe("127.0.0.1:18850");
  });

  test("ensureS3Bucket throws other errors", async () => {
    return expect(
      ensureS3Bucket({
        bucket: "oke",
        endpoint: "http://127.0.0.1:18850",
        accessKeyId: "AKIA",
        secretAccessKey: "secret",
        fetch: (async () => new Response("AccessDenied", { status: 403 })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/create bucket "oke" failed \(403\)/);
  });

  test("injected client skips CreateBucket and still puts", async () => {
    const handle = await openS3Bucket({ name: "attachments", client: createS3FakeClient() });
    await handle.put("a.txt", "ok");
    expect(new TextDecoder().decode((await handle.get("a.txt"))!)).toBe("ok");
    await handle.close();
  });
});
