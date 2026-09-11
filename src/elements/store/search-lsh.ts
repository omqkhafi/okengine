/**
 * Random-hyperplane LSH — K fixed planes generated once per field lifetime.
 */

import { createHash } from "node:crypto";
import { LSH_DEFAULT_K } from "./search-errors.ts";

/**
 * Stable seed string for a field's hyperplanes.
 *
 * @param table - SQL table
 * @param column - SQL column
 * @param dims - Embedding dimensionality
 * @param k - Number of planes
 */
export function hyperplaneSeed(table: string, column: string, dims: number, k: number): string {
  return `${table}|${column}|${dims}|${k}`;
}

/**
 * Generate K unit-ish random hyperplanes in `dims` dimensions from a seed.
 * Deterministic across hosts for the same seed.
 *
 * @param seed - Stable seed string
 * @param dims - Vector dimensionality
 * @param k - Plane count (default {@link LSH_DEFAULT_K})
 */
export function generateHyperplanes(
  seed: string,
  dims: number,
  k: number = LSH_DEFAULT_K,
): Float32Array[] {
  const planes: Float32Array[] = [];
  let counter = 0;
  for (let i = 0; i < k; i++) {
    const plane = new Float32Array(dims);
    let filled = 0;
    while (filled < dims) {
      const h = createHash("sha256").update(`${seed}\0${counter++}`).digest();
      for (let b = 0; b + 3 < h.length && filled < dims; b += 4) {
        const u = h.readUInt32BE(b) / 0xffff_ffff;
        plane[filled++] = u * 2 - 1;
      }
    }
    // L2 normalize
    let norm = 0;
    for (let j = 0; j < dims; j++) norm += plane[j]! * plane[j]!;
    norm = Math.sqrt(norm) || 1;
    for (let j = 0; j < dims; j++) plane[j]! /= norm;
    planes.push(plane);
  }
  return planes;
}

/**
 * Pack LSH bucket bits into a bigint (K ≤ 64).
 *
 * @param vector - Embedding
 * @param planes - Fixed hyperplanes
 */
export function lshBucket(vector: readonly number[], planes: readonly Float32Array[]): bigint {
  if (planes.length > 64) {
    throw new Error(`lshBucket: K=${planes.length} exceeds bigint packing (max 64)`);
  }
  let bits = 0n;
  for (let i = 0; i < planes.length; i++) {
    const plane = planes[i]!;
    if (vector.length !== plane.length) {
      throw new Error(`lshBucket: vector length ${vector.length} !== plane dims ${plane.length}`);
    }
    let dot = 0;
    for (let j = 0; j < plane.length; j++) {
      dot += vector[j]! * plane[j]!;
    }
    if (dot >= 0) bits |= 1n << BigInt(i);
  }
  return bits;
}

/**
 * Encode an LSH bucket for PostgreSQL `bigint` (signed int64).
 * K=64 bit patterns with the high bit set exceed unsigned range when passed
 * as a decimal string — reinterpret as two's-complement signed.
 *
 * @param bucket - Unsigned bit pack from {@link lshBucket}
 */
export function lshBucketToSql(bucket: bigint): string {
  const masked = bucket & 0xffff_ffff_ffff_ffffn;
  if (masked >= 0x8000_0000_0000_0000n) {
    return (masked - 0x1_0000_0000_0000_0000n).toString();
  }
  return masked.toString();
}

/**
 * Decode a PostgreSQL `bigint` LSH value back to an unsigned bit pack.
 *
 * @param value - Driver value (string | number | bigint)
 */
export function lshBucketFromSql(value: unknown): bigint {
  const n = typeof value === "bigint" ? value : BigInt(String(value));
  return n < 0n ? n + 0x1_0000_0000_0000_0000n : n;
}

/**
 * Cosine similarity in [−1, 1].
 *
 * @param a - Vector a
 * @param b - Vector b
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Hamming distance between two K-bit LSH packs (K ≤ 64).
 *
 * Random-hyperplane (Charikar) SimHash ranks neighbors by this distance.
 * Hamming-1 equality is not a viable candidate set at {@link LSH_DEFAULT_K}:
 * true near-neighbors typically sit at distance ~5–16, not 0–1.
 *
 * @param a - Bucket a
 * @param b - Bucket b
 */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = (a ^ b) & 0xffff_ffff_ffff_ffffn;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}

/**
 * Candidate buckets: exact match plus Hamming distance 1 flips.
 *
 * Kept for tight-collision tests and callers that want a 65-wide equality
 * probe. Query-time retrieval uses {@link lshHammingSql} ranking instead —
 * Hamming-1 alone misses almost all true neighbors at K=64.
 *
 * @param bucket - Query bucket
 * @param k - Bit width
 */
export function neighborBuckets(bucket: bigint, k: number): bigint[] {
  const out: bigint[] = [bucket];
  for (let i = 0; i < k; i++) {
    out.push(bucket ^ (1n << BigInt(i)));
  }
  return out;
}

/**
 * Postgres 14+ Hamming distance between a stored signed-int64 LSH column
 * and a bound query bucket (`?::bigint`). Used as `ORDER BY … LIMIT k`.
 *
 * @param columnSql - Quoted LSH column identifier
 * @param bucketPlaceholder - Bound-parameter placeholder (`?` before `$n` rewrite)
 */
export function lshHammingSql(columnSql: string, bucketPlaceholder: string = "?"): string {
  return `bit_count((${columnSql} # ${bucketPlaceholder}::bigint)::bit(64))`;
}

/**
 * Serialize planes for `oke_search_planes.planes` (Float32 little-endian).
 *
 * @param planes - Hyperplanes
 */
export function serializePlanes(planes: readonly Float32Array[]): Buffer {
  const dims = planes[0]?.length ?? 0;
  const buf = Buffer.allocUnsafe(4 + planes.length * dims * 4);
  buf.writeUInt32LE(dims, 0);
  let offset = 4;
  for (const plane of planes) {
    for (let i = 0; i < dims; i++) {
      buf.writeFloatLE(plane[i]!, offset);
      offset += 4;
    }
  }
  return buf;
}

/**
 * Deserialize planes from storage.
 *
 * @param buf - Stored bytes
 * @param k - Expected plane count
 */
export function deserializePlanes(buf: Buffer, k: number): Float32Array[] {
  const dims = buf.readUInt32LE(0);
  const planes: Float32Array[] = [];
  let offset = 4;
  for (let i = 0; i < k; i++) {
    const plane = new Float32Array(dims);
    for (let j = 0; j < dims; j++) {
      plane[j] = buf.readFloatLE(offset);
      offset += 4;
    }
    planes.push(plane);
  }
  return planes;
}
