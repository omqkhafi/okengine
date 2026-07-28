/**
 * `s3` driver — binds `Bun.S3` / `Bun.S3Client` (never aws-sdk).
 *
 * Protocol-named: AWS S3 · R2 · MinIO · SeaweedFS · Garage · Backblaze.
 */

import type { FilesBucket, FilesDriver, FilesOpenOptions, S3ClientLike } from "./types.ts";

/**
 * Open a files bucket over the S3 protocol.
 *
 * @param options - Bucket name / injected client
 */
export async function openS3Bucket(options: FilesOpenOptions): Promise<FilesBucket> {
  const client: S3ClientLike = options.client ?? createBunS3Client(options.root ?? options.name);

  const prefix = "";

  return {
    driverId: "s3",
    async put(key, data) {
      await client.file(prefix + key).write(data);
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

function createBunS3Client(bucket: string): S3ClientLike {
  const s3 = new Bun.S3Client({ bucket });
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
