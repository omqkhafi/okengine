/**
 * OKID constants and the options-path encoder.
 *
 * The default `okid()` / `okid(length)` hot path does not import the
 * alphabet resolver — only these constants and {@link assertLength}.
 */

/**
 * Default `okid()` / `okid(length)` alphabet.
 *
 * Same 64-character set and order as
 * `resolveAlphabet(true, true, true, true, true)` (numbers, lowercase,
 * uppercase, symbols). Power-of-two size, so a bitmask is unbiased.
 */
export const OKID_DEFAULT_CHARS =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";

/**
 * Characters removed when `lookAlikes` is disabled (human transcription).
 */
export const OKID_LOOKALIKE_CHARS = "1lI0Oouv5Ss";

/** Default URL-safe alphabet: Base64URL charset in its conventional order. */
export const OKID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Codepoint-ordered variant of {@link OKID_ALPHABET}: identical characters,
 * sorted by code unit so plain string comparison equals value comparison.
 * The default Base64URL order is NOT lexicographic (`_` sorts between `Z`
 * and `a`), which would silently break time ordering — so the sortable
 * encoder always uses this order.
 *
 * Kept as a literal (not `[...OKID_ALPHABET].sort().join("")`) so the public
 * JSR API stays fast-type / explicitly typed.
 */
export const OKID_SORTABLE_ALPHABET: string =
  "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";

/** Default id length — 21 chars × 6 bits = 126 bits of entropy. */
export const OKID_DEFAULT_LENGTH = 21;

/** Shortest permitted id length (8 chars ≈ 48 bits entropy floor). */
export const OKID_MIN_LENGTH = 8;

/** Longest permitted id length. */
export const OKID_MAX_LENGTH = 128;

/** Sortable ids need ≥ 16: 8 timestamp chars alone would leave no randomness. */
export const OKID_SORTABLE_MIN_LENGTH = 16;

/** Longest permitted semantic {@link OkidOptions.prefix}. */
export const OKID_MAX_PREFIX_LENGTH = 32;

/** Options for {@link okid}. All alphabet toggles default to included. */
export interface OkidOptions {
  /**
   * Generated body length (default {@link OKID_DEFAULT_LENGTH}). Does not
   * include {@link prefix} — the returned string is `prefix + body`.
   */
  readonly length?: number;
  /**
   * Fixed semantic label prepended to the body (e.g. `"usr_"`, `"evt_"`).
   * Characters must belong to {@link OKID_ALPHABET}; max
   * {@link OKID_MAX_PREFIX_LENGTH}. Empty / omitted means no label.
   */
  readonly prefix?: string;
  /**
   * Prefix the body with a 48-bit epoch-ms timestamp (exactly 8 chars) so
   * lexicographic order tracks creation time across milliseconds. Alphabet
   * toggles are ignored under this mode — see {@link OKID_SORTABLE_ALPHABET}.
   * Combines with {@link prefix}: `prefix + timestamp + random`.
   */
  readonly sortable?: boolean;
  /** Include `a-z` (default true). */
  readonly lowercase?: boolean;
  /** Include `A-Z` (default true). */
  readonly uppercase?: boolean;
  /** Include `0-9` (default true). */
  readonly numbers?: boolean;
  /** Include `-` and `_` (default true). */
  readonly symbols?: boolean;
  /**
   * Include visually confusable characters (`1lI0Oouv5Ss`, default true).
   * Set `false` to drop them for human transcription.
   */
  readonly lookAlikes?: boolean;
}

/**
 * Assert `length` is a valid integer within bounds for the requested mode.
 *
 * @param length - Requested length
 * @param min - Mode-specific minimum
 * @param label - Option name used in the error message
 */
export function assertLength(length: number, min: number, label: string): void {
  if (!Number.isInteger(length)) {
    throw new RangeError(`okid: ${label} must be an integer, got ${length}`);
  }
  if (length < min || length > OKID_MAX_LENGTH) {
    throw new RangeError(`okid: ${label} ${length} is out of range [${min}, ${OKID_MAX_LENGTH}]`);
  }
}
