/**
 * Console index browse — lexical rank over listed documents (id + meta).
 *
 * Vector ANN still goes through `idx.search(vector)`. This ranks stored
 * titles / identifiers so an operator can type a phrase instead of a vector.
 */

/** One listed index document (score is ignored when ranking). */
export type IndexSearchDoc = {
  readonly id: string;
  readonly meta?: Record<string, unknown>;
};

/** Ranked hit returned to the Console grid. */
export type IndexSearchHit = {
  readonly id: string;
  readonly score: number;
  readonly meta?: Record<string, unknown>;
};

/**
 * Flatten id + string-ish meta into a searchable haystack.
 *
 * @param doc - Listed document
 */
export function indexDocHaystack(doc: IndexSearchDoc): string {
  const parts = [doc.id];
  for (const value of Object.values(doc.meta ?? {})) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      parts.push(String(value));
    }
  }
  return parts.join(" ").toLowerCase();
}

/**
 * Split a query into lowercase alphanumeric tokens.
 *
 * @param text - Raw query
 */
export function tokenizeIndexQuery(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0);
}

/**
 * Rank listed documents against a human query. Higher score is better.
 *
 * @param docs - Listed id + meta rows
 * @param query - Phrase or identifier
 * @param topK - Max hits
 */
export function rankIndexHits(
  docs: readonly IndexSearchDoc[],
  query: string,
  topK: number,
): IndexSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const tokens = tokenizeIndexQuery(needle);
  const cap = Math.max(1, Math.floor(topK));
  const hits: IndexSearchHit[] = [];

  for (const doc of docs) {
    const score = scoreIndexDoc(doc, needle, tokens);
    if (score <= 0) continue;
    hits.push({
      id: doc.id,
      score,
      ...(doc.meta ? { meta: doc.meta } : {}),
    });
  }

  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return hits.slice(0, cap);
}

function scoreIndexDoc(doc: IndexSearchDoc, needle: string, tokens: readonly string[]): number {
  const id = doc.id.toLowerCase();
  if (id === needle) return 1;
  const identifier = stringMeta(doc.meta, "identifier")?.toLowerCase();
  if (identifier === needle) return 0.98;
  const title = stringMeta(doc.meta, "title")?.toLowerCase();
  if (title === needle) return 0.96;
  if (id.includes(needle)) return 0.9;
  if (identifier?.includes(needle)) return 0.88;
  if (title?.includes(needle)) return 0.85;

  const hay = indexDocHaystack(doc);
  if (hay.includes(needle)) return 0.8;
  if (tokens.length === 0) return 0;
  const matched = tokens.filter((token) => hay.includes(token)).length;
  if (matched === 0) return 0;
  return 0.2 + 0.55 * (matched / tokens.length);
}

function stringMeta(meta: Record<string, unknown> | undefined, key: string): string | null {
  const value = meta?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
