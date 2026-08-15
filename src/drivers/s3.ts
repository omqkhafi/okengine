/**
 * `s3` driver — binds `Bun.S3` / `Bun.S3Client` (never aws-sdk).
 *
 * Protocol-named: AWS S3 · R2 · MinIO · SeaweedFS · Garage · Backblaze.
 */

import type { FilesBucket, FilesDriver, FilesOpenOptions, S3ClientLike } from "./types.ts";
import { ensureS3Bucket, isMissingS3BucketError } from "./s3-ensure-bucket.ts";

/**
 * Open a files bucket over the S3 protocol.
 *
 * @param options - Bucket name / injected client
 */
export async function openS3Bucket(options: FilesOpenOptions): Promise<FilesBucket> {
  const bucketName = options.root ?? options.name;
  const client: S3ClientLike = options.client ?? createBunS3Client(bucketName);
  if (!options.client) await ensureS3BucketFromEnv(bucketName);

  const prefix = "";

  return {
    driverId: "s3",
    async put(key, data) {
      try {
        await client.file(prefix + key).write(data);
      } catch (err) {
        if (!options.client && isMissingS3BucketError(err)) {
          await ensureS3BucketFromEnv(bucketName);
          await client.file(prefix + key).write(data);
          return;
        }
        throw err;
      }
    },
    async get(key) {
      const file = client.file(prefix + key);
      if (!(await file.exists())) return null;
      return new Uint8Array(await file.arrayBuffer());
    },
    async delete(key) {
      const file = client.file(prefix + key);
      if (!(await file.exists())) return false;
      await file.delete();
      return true;
    },
    async list(listPrefix = "") {
      const result = await client.list({ prefix: listPrefix });
      return (result.contents ?? [])
        .map((o) => o.key)
        .filter((k): k is string => typeof k === "string")
        .sort();
    },
    async close() {
      /* S3 clients are stateless */
    },
  };
}

/**
 * CreateBucket on a custom S3 endpoint (Compose RustFS / MinIO).
 * Skipped without `S3_ENDPOINT` so real AWS is not auto-provisioned.
 *
 * @param bucket - Bucket name (`S3_BUCKET` / store name)
 */
export async function ensureS3BucketFromEnv(bucket: string): Promise<void> {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !accessKeyId || !secretAccessKey) return;
  await ensureS3Bucket({
    bucket,
    endpoint,
    accessKeyId,
    secretAccessKey,
    region: process.env.S3_REGION?.trim() || "us-east-1",
  });
}

function createBunS3Client(bucket: string): S3ClientLike {
  const s3 = new Bun.S3Client({
    bucket,
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    ...(process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID } : {}),
    ...(process.env.S3_SECRET_ACCESS_KEY
      ? { secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
      : {}),
    ...(process.env.S3_REGION ? { region: process.env.S3_REGION } : {}),
    ...(process.env.S3_SESSION_TOKEN ? { sessionToken: process.env.S3_SESSION_TOKEN } : {}),
  });
  return {
    file(key: string) {
      const f = s3.file(key);
      return {
        write: (data) => f.write(data),
        arrayBuffer: () => f.arrayBuffer(),
        exists: () => f.exists(),
        delete: () => f.delete(),
      };
    },
    async list(options) {
      const result = await s3.list({ prefix: options?.prefix });
      return {
        contents: (result.contents ?? []).map((o) => ({
          key: o.key,
        })),
      };
    },
  };
}

/**
 * In-memory S3-protocol fake for conformance without credentials.
 */
export function createS3FakeClient(): S3ClientLike & {
  readonly objects: Map<string, Uint8Array>;
} {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    file(key: string) {
      return {
        async write(data) {
          const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
          objects.set(key, bytes);
          return bytes.byteLength;
        },
        async arrayBuffer() {
          const bytes = objects.get(key);
          if (!bytes) throw new Error(`S3 fake: missing ${key}`);
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
        },
        async exists() {
          return objects.has(key);
        },
        async delete() {
          objects.delete(key);
        },
      };
    },
    async list(options) {
      const prefix = options?.prefix ?? "";
      return {
        contents: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })),
      };
    },
  };
}

/** Protocol-named s3 driver. */
export const s3Driver: FilesDriver = {
  id: "s3",
  facet: "files",
  open: openS3Bucket,
};
