/**
 * Create the configured S3 bucket when a custom endpoint (RustFS / MinIO)
 * starts empty. Bun.S3Client has no CreateBucket.
 */

import { createHash, createHmac } from "node:crypto";

/** Empty-body SHA-256 (CreateBucket has no payload). */
export const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

/** Options for {@link ensureS3Bucket}. */
export interface EnsureS3BucketOptions {
  readonly bucket: string;
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region?: string;
  readonly fetch?: typeof fetch;
  readonly now?: Date;
}

/**
 * True when an S3/RustFS error means the bucket was never created.
 *
 * @param err - Thrown write / list error
 */
export function isMissingS3BucketError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /specified bucket does not exist|NoSuchBucket/i.test(msg);
}

/**
 * True when CreateBucket already succeeded (idempotent).
 *
 * @param status - HTTP status
 * @param body - Response text
 */
export function isS3BucketAlreadyExists(status: number, body: string): boolean {
  if (status === 200 || status === 204 || status === 409) return true;
  return /BucketAlreadyOwnedByYou|BucketAlreadyExists|already exist/i.test(body);
}

/**
 * PUT the bucket (path-style) on a custom S3 endpoint. No-op when
 * `endpoint` / credentials are missing.
 *
 * @param options - Bucket + endpoint + keys
 */
export async function ensureS3Bucket(options: EnsureS3BucketOptions): Promise<void> {
  const endpoint = options.endpoint.trim();
  const bucket = options.bucket.trim();
  if (endpoint.length === 0 || bucket.length === 0) return;
  if (options.accessKeyId.length === 0 || options.secretAccessKey.length === 0) return;

  const region = options.region?.trim() || "us-east-1";
  const now = options.now ?? new Date();
  const base = endpoint.replace(/\/$/, "");
  const url = `${base}/${encodeURIComponent(bucket)}`;
  const host = hostHeader(base);
  const headers = signS3PutBucket({
    bucket,
    host,
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region,
    now,
  });

  const res = await (options.fetch ?? fetch)(url, { method: "PUT", headers });
  const body = await res.text();
  if (res.ok || isS3BucketAlreadyExists(res.status, body)) return;
  throw new Error(
    `s3: create bucket ${JSON.stringify(bucket)} failed (${res.status}): ${body.slice(0, 240)}`,
  );
}

/**
 * Host header for an origin (`http://127.0.0.1:18850` → `127.0.0.1:18850`).
 *
 * @param origin - Endpoint origin
 */
export function hostHeader(origin: string): string {
  const u = new URL(origin);
  return u.host;
}

/**
 * Sign `PUT /{bucket}` with an empty body.
 *
 * @param input - Bucket, host, keys, region, clock
 */
export function signS3PutBucket(input: {
  readonly bucket: string;
  readonly host: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  readonly now: Date;
}): Record<string, string> {
  const amzDate = amzDateStamp(input.now);
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = `/${encodeURIComponent(input.bucket)}`;
  const canonicalHeaders =
    `host:${input.host}\n` + `x-amz-content-sha256:${EMPTY_SHA256}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    EMPTY_SHA256,
  ].join("\n");
  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = aws4SigningKey(input.secretAccessKey, dateStamp, input.region, "s3");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  return {
    host: input.host,
    "x-amz-content-sha256": EMPTY_SHA256,
    "x-amz-date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function amzDateStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function aws4SigningKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = createHmac("sha256", `AWS4${secret}`).update(dateStamp, "utf8").digest();
  const kRegion = createHmac("sha256", kDate).update(region, "utf8").digest();
  const kService = createHmac("sha256", kRegion).update(service, "utf8").digest();
  return createHmac("sha256", kService).update("aws4_request", "utf8").digest();
}
