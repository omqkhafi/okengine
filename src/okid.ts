/**
 * OKID — OKE's native id generator.
 *
 * A compact, URL-safe, cryptographically random identifier with an opt-in
 * time-sortable variant and opt-in alphabet control. Zero dependencies, zero
 * shared state, safe under concurrent generation.
 *
 * Design properties:
 *
 * - **Default form** — 21 chars over a 64-char URL-safe alphabet
 *   (`A-Za-z0-9-_`) = exactly 6 bits per char = **126 bits** of entropy.
 *   Birthday bound: n² / 2¹²⁷ — generating one billion ids yields a collision
 *   probability around 10⁻²¹. No timestamps, counters, or machine
 *   fingerprints are exposed by default.
 * - **Sortable variant** — `okid({ sortable: true })` prefixes the id with a
 *   48-bit epoch-millisecond timestamp encoded in exactly 8 chars, leaving
 *   `length − 8` random chars (78 bits at the default length). Lexicographic
 *   order equals time order across milliseconds; ids minted within the same
 *   millisecond tie on the prefix and carry no intra-ms ordering. Clock skew
 *   distorts ordering but can never cause duplicates (the tail stays random).
 * - **Alphabet control** — group toggles (`numbers`, `lowercase`,
 *   `uppercase`, `symbols`) and `lookAlikes` shrink the alphabet for
 *   human-transcribed codes. Non-power-of-two alphabets use rejection
 *   sampling, so every character remains equally likely — no modulo bias at
 *   any alphabet size.
 * - **Randomness** — exclusively `crypto.getRandomValues()`. Never
 *   `Math.random`. Stateless, therefore concurrency-safe.
 *
 * Use OKID for application identifiers: database primary keys, request /
 * job / workflow / resource ids. Do NOT use it as a secret or token (ids are
 * not unguessable credentials), and use UUID instead where an external
 * protocol explicitly requires that format. Sortable ids embed their creation
 * time (~ms precision) — keep them internal, not publicly enumerable.
 *
 * @example
 * ```ts
 * import { okid } from "okengine/okid";
 *
 * const userId = okid();                       // 21 chars, 126 bits
 * const requestId = okid(16);                  // explicit length
 * const eventKey = okid({ sortable: true });   // time-prefixed
 * const inviteCode = okid({
 *   lookAlikes: false,
 *   uppercase: false,
 * });                                          // human-transcribable
 * ```
 *
 * @module
 */

/** Character groups addressable through {@link OkidOptions} toggles. */
const GROUPS = {
  numbers: "0123456789",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  symbols: "-_",
} as const;

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

/** Options for {@link okid}. All alphabet toggles default to included. */
export interface OkidOptions {
  /** Total id length (default {@link OKID_DEFAULT_LENGTH}). */
  readonly length?: number;
  /**
   * Prefix a 48-bit epoch-ms timestamp (exactly 8 chars) so lexicographic
   * order tracks creation time across milliseconds. Alphabet toggles are
   * ignored under this mode — see {@link OKID_SORTABLE_ALPHABET}.
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

/** Resolved alphabet + encoding metadata for one options combination. */
interface ResolvedAlphabet {
  readonly chars: string;
  readonly size: number;
  /** Bitmask covering `size` values (`size` is always a power of two here). */
  readonly mask: number;
}

/** Memoized resolutions keyed by the toggle bitmask (32 combinations max). */
const ALPHABET_CACHE = new Map<number, ResolvedAlphabet>();

function resolveAlphabet(
  numbers: boolean,
  lowercase: boolean,
  uppercase: boolean,
  symbols: boolean,
  lookAlikes: boolean,
): ResolvedAlphabet {
  const key =
    (numbers ? 1 : 0) |
    (lowercase ? 2 : 0) |
    (uppercase ? 4 : 0) |
    (symbols ? 8 : 0) |
    (lookAlikes ? 0 : 16);
  const cached = ALPHABET_CACHE.get(key);
  if (cached) return cached;

  let chars = "";
  if (numbers) chars += GROUPS.numbers;
  if (lowercase) chars += GROUPS.lowercase;
  if (uppercase) chars += GROUPS.uppercase;
  if (symbols) chars += GROUPS.symbols;
  if (!chars) {
    throw new RangeError("okid: alphabet is empty — enable at least one character group");
  }
  if (!lookAlikes) {
    chars = [...chars].filter((c) => !OKID_LOOKALIKE_CHARS.includes(c)).join("");
  }

  // Round up to a power of two for mask-based rejection sampling: bytes below
  // `size` map uniformly, bytes above are discarded and re-drawn — unbiased at
  // every alphabet size, unlike naive modulo.
  const rawSize = chars.length;
  const size = 1 << Math.ceil(Math.log2(rawSize));
  const resolved: ResolvedAlphabet = { chars, size: rawSize, mask: size - 1 };
  ALPHABET_CACHE.set(key, resolved);
  return resolved;
}

/** Encode one random byte stream into `length` characters of `alphabet`. */
function encode(alphabet: ResolvedAlphabet, length: number): string {
  const { chars, size, mask } = alphabet;
  const bytes = new Uint8Array(length + Math.ceil(length >> 2));
  crypto.getRandomValues(bytes.subarray(0, length));
  let out = "";
  let i = 0;
  while (out.length < length && i < bytes.length) {
    const byte = bytes[i++]!;
    if ((byte & mask) < size) out += chars[byte & mask];
  }
  return out;
}

/** Pack epoch-ms into exactly 8 codepoint-ordered characters (48 bits). */
function encodeTimestamp(nowMs: number): string {
  let t = nowMs % 2 ** 48;
  let out = "";
  for (let i = 0; i < 8; i++) {
    out = OKID_SORTABLE_ALPHABET[t & 63]! + out;
    t = Math.floor(t / 64);
  }
  return out;
}

/**
 * Assert `length` is a valid integer within bounds for the requested mode.
 *
 * @param length - Requested length
 * @param min - Mode-specific minimum
 * @param label - Option name used in the error message
 */
function assertLength(length: number, min: number, label: string): void {
  if (!Number.isInteger(length)) {
    throw new RangeError(`okid: ${label} must be an integer, got ${length}`);
  }
  if (length < min || length > OKID_MAX_LENGTH) {
    throw new RangeError(`okid: ${label} ${length} is out of range [${min}, ${OKID_MAX_LENGTH}]`);
  }
}

/**
 * Generate an OKE-native id.
 *
 * Accepts either a bare length or an options object; the bare-number form is
 * the hot path and skips all option resolution beyond validation.
 *
 * @param options - Length in chars, or {@link OkidOptions}
 * @returns A URL-safe id of exactly the requested length
 * @throws RangeError on invalid input (non-integer, out-of-range length,
 * empty alphabet)
 */
export function okid(options: number | OkidOptions = OKID_DEFAULT_LENGTH): string {
  if (typeof options === "number") {
    assertLength(options, OKID_MIN_LENGTH, "length");
    return encode(resolveAlphabet(true, true, true, true, true), options);
  }

  const {
    length = OKID_DEFAULT_LENGTH,
    sortable = false,
    lowercase = true,
    uppercase = true,
    numbers = true,
    symbols = true,
    lookAlikes = true,
  } = options;

  if (sortable) {
    assertLength(length, OKID_SORTABLE_MIN_LENGTH, "length");
    // Time ordering requires lexicographic encoding, which requires the full
    // codepoint-ordered alphabet — partial subsets cannot preserve both the
    // caller's charset choice AND cross-ms ordering, so toggles are ignored.
    const alphabet = resolveAlphabet(true, true, true, true, true);
    return encodeTimestamp(Date.now()) + encode(alphabet, length - 8);
  }

  assertLength(length, OKID_MIN_LENGTH, "length");
  return encode(resolveAlphabet(numbers, lowercase, uppercase, symbols, lookAlikes), length);
}
