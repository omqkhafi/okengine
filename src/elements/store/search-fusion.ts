/**
 * Rank fusion — RRF (default) and weighted combination (opt-in).
 */

import { RRF_DEFAULT_K } from "./search-errors.ts";

/** One ranked list entry (1-based rank preferred for RRF). */
export interface RankedHit {
  readonly id: string;
  readonly score: number;
  readonly rank: number;
}

export type FuseStrategy = "rrf" | "weighted";

export interface FuseOptions {
  readonly strategy?: FuseStrategy;
  /** RRF damping constant — default {@link RRF_DEFAULT_K} (Cormack et al. 2009). */
  readonly k?: number;
  /** Weighted fusion only. */
  readonly weights?: { readonly bm25?: number; readonly vector?: number };
}

/**
 * Reciprocal Rank Fusion: Σ 1/(k + rank).
 *
 * @param lists - Named ranked lists (e.g. bm25, vector)
 * @param k - Damping constant
 */
export function fuseRrf(
  lists: ReadonlyMap<string, readonly RankedHit[]>,
  k: number = RRF_DEFAULT_K,
): RankedHit[] {
  const scores = new Map<string, number>();
  for (const list of lists.values()) {
    for (const hit of list) {
      const contrib = 1 / (k + hit.rank);
      scores.set(hit.id, (scores.get(hit.id) ?? 0) + contrib);
    }
  }
  return toRanked(scores);
}

/**
 * Weighted linear combination of raw scores (min-max normalized per list).
 *
 * @param lists - Named scored lists
 * @param weights - Per-engine weights
 */
export function fuseWeighted(
  lists: ReadonlyMap<string, readonly RankedHit[]>,
  weights: { readonly bm25?: number; readonly vector?: number } = {},
): RankedHit[] {
  const wBm25 = weights.bm25 ?? 0.5;
  const wVec = weights.vector ?? 0.5;
  const norm = normalizeLists(lists);
  const scores = new Map<string, number>();
  for (const [name, list] of norm) {
    const w = name === "vector" ? wVec : name === "bm25" ? wBm25 : 1;
    for (const hit of list) {
      scores.set(hit.id, (scores.get(hit.id) ?? 0) + w * hit.score);
    }
  }
  return toRanked(scores);
}

/**
 * Apply {@link FuseOptions} — omitted / rrf → RRF with k=60.
 *
 * @param lists - Ranked lists
 * @param fuse - Options
 */
export function fuseLists(
  lists: ReadonlyMap<string, readonly RankedHit[]>,
  fuse?: FuseOptions,
): { hits: RankedHit[]; strategy: FuseStrategy; k?: number } {
  const strategy = fuse?.strategy ?? "rrf";
  if (strategy === "weighted") {
    return { hits: fuseWeighted(lists, fuse?.weights), strategy };
  }
  const k = fuse?.k ?? RRF_DEFAULT_K;
  return { hits: fuseRrf(lists, k), strategy, k };
}

function normalizeLists(
  lists: ReadonlyMap<string, readonly RankedHit[]>,
): Map<string, RankedHit[]> {
  const out = new Map<string, RankedHit[]>();
  for (const [name, list] of lists) {
    let min = Infinity;
    let max = -Infinity;
    for (const h of list) {
      if (h.score < min) min = h.score;
      if (h.score > max) max = h.score;
    }
    const span = max - min || 1;
    out.set(
      name,
      list.map((h) => ({
        id: h.id,
        rank: h.rank,
        score: (h.score - min) / span,
      })),
    );
  }
  return out;
}

function toRanked(scores: Map<string, number>): RankedHit[] {
  const sorted = [...scores.entries()].sort((a, b) => b[1]! - a[1]!);
  return sorted.map(([id, score], i) => ({ id, score, rank: i + 1 }));
}
