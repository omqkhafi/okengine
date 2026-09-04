/**
 * BM25F scoring — Robertson–Zaragoza with field weights applied to TF
 * **before** saturation (not post-hoc score summing).
 */

import { BM25_B, BM25_K1 } from "./search-errors.ts";

/** One field's contribution to a document. */
export interface Bm25FieldTerms {
  readonly weight: number;
  /** term → raw term frequency in this field */
  readonly tf: ReadonlyMap<string, number>;
}

/**
 * BM25F score for one document given query terms and corpus stats.
 *
 * @param queryTerms - Tokenized query (unique terms scored once)
 * @param fields - Per-field TF maps with BM25F weights
 * @param docLen - Total document length (sum of field token counts)
 * @param avgdl - Corpus average document length
 * @param N - Corpus size
 * @param df - Document frequency per term
 */
export function bm25fScore(
  queryTerms: readonly string[],
  fields: readonly Bm25FieldTerms[],
  docLen: number,
  avgdl: number,
  N: number,
  df: ReadonlyMap<string, number>,
): number {
  if (N <= 0 || avgdl <= 0) return 0;
  let score = 0;
  const seen = new Set<string>();
  for (const term of queryTerms) {
    if (seen.has(term)) continue;
    seen.add(term);
    let weightedTf = 0;
    for (const field of fields) {
      const tf = field.tf.get(term) ?? 0;
      if (tf > 0) weightedTf += field.weight * tf;
    }
    if (weightedTf <= 0) continue;
    const n = df.get(term) ?? 0;
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    const denom = weightedTf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgdl));
    score += idf * ((weightedTf * (BM25_K1 + 1)) / denom);
  }
  return score;
}

/**
 * Simple whitespace + lower-case tokenizer for BM25 (English-oriented).
 * Used for in-process scoring and tests; SQL path uses to_tsvector terms.
 *
 * @param text - Raw text
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Build a TF map from tokens.
 *
 * @param tokens - Token list
 */
export function termFrequencies(tokens: readonly string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}
