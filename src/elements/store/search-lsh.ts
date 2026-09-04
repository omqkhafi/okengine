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
  return `${table}\0${column}\0${dims}\0${k}`;
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
      throw new Error(
        `lshBucket: vector length ${vector.length} !== plane dims ${plane.length}`,
      );
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
 * Candidate buckets: exact match plus Hamming distance 1 flips.
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
