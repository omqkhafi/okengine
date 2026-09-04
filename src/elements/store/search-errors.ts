/**
 * Fail-loud errors for built-in hybrid SQL search.
 */

/** Thrown when `.embed()` / search config is invalid or AI is missing. */
export class SearchConfigError extends Error {
  override readonly name = "SearchConfigError";
  readonly table: string;
  readonly column: string;

  /**
   * @param table - SQL table name
   * @param column - JS or SQL column key
   * @param message - Human-readable fix
   */
  constructor(table: string, column: string, message: string) {
    super(`SearchConfigError: ${table}.${column}: ${message}`);
    this.table = table;
    this.column = column;
  }
}

/** Corpus size below which IDF / BM25 stats are not meaningful. */
export const SEARCH_LOW_CORPUS_WARN_N = 100;

/** Default RRF damping constant (Cormack, Clarke, Büttcher — SIGIR 2009). */
export const RRF_DEFAULT_K = 60;

/** Fixed LSH hyperplane count (fits bigint bit packing). */
export const LSH_DEFAULT_K = 64;

/** BM25 saturation / length-norm defaults (Robertson–Zaragoza). */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
