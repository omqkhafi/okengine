/**
 * `okid({ … })` options path — sortable, prefix, and alphabet toggles.
 *
 * Kept off the kernel edge profile. `okid()` and `okid(length)` never load it.
 */

import {
  assertLength,
  OKID_ALPHABET,
  OKID_DEFAULT_LENGTH,
  OKID_LOOKALIKE_CHARS,
  OKID_MAX_PREFIX_LENGTH,
  OKID_MIN_LENGTH,
  OKID_SORTABLE_ALPHABET,
  OKID_SORTABLE_MIN_LENGTH,
  type OkidOptions,
} from "./okid-shared.ts";

/** Character groups addressable through {@link OkidOptions} toggles. */
const GROUPS = {
  numbers: "0123456789",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  symbols: "-_",
} as const;

/** Resolved alphabet + encoding metadata for one options combination. */
interface ResolvedAlphabet {
  readonly chars: string;
  readonly size: number;
  /** Bitmask covering `size` values (`size` is always a power of two here). */
  readonly mask: number;
}

/** Memoized resolutions keyed by the toggle bitmask (32 combinations max). */
const ALPHABET_CACHE = new Map<number, ResolvedAlphabet>();

/**
 * Resolve a toggle combination to an alphabet and rejection-sampling mask.
 *
 * @param numbers - Include `0-9`
 * @param lowercase - Include `a-z`
 * @param uppercase - Include `A-Z`
 * @param symbols - Include `-` and `_`
 * @param lookAlikes - Include visually confusable characters
 */
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

/**
 * Encode one random byte stream into `length` characters of `alphabet`.
 *
 * @param alphabet - Resolved charset
 * @param length - Output length
 */
function encodeAlphabet(alphabet: ResolvedAlphabet, length: number): string {
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

/**
 * Pack epoch-ms into exactly 8 codepoint-ordered characters (48 bits).
 *
 * @param nowMs - Epoch milliseconds
 */
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
 * Assert a semantic prefix is within bounds and stays on the URL-safe alphabet.
 *
 * @param prefix - Caller-supplied label
 */
function assertPrefix(prefix: string): void {
  if (prefix.length > OKID_MAX_PREFIX_LENGTH) {
    throw new RangeError(
      `okid: prefix length ${prefix.length} exceeds max ${OKID_MAX_PREFIX_LENGTH}`,
    );
  }
  for (const char of prefix) {
    if (!OKID_ALPHABET.includes(char)) {
      throw new RangeError(
        `okid: prefix contains invalid character ${JSON.stringify(char)} — use characters from OKID_ALPHABET`,
      );
    }
  }
}

/**
 * Generate an id from an options object.
 *
 * @param options - Length, prefix, sortable, and alphabet toggles
 */
export function okidWithOptions(options: OkidOptions): string {
  const {
    length = OKID_DEFAULT_LENGTH,
    prefix = "",
    sortable = false,
    lowercase = true,
    uppercase = true,
    numbers = true,
    symbols = true,
    lookAlikes = true,
  } = options;

  if (prefix) assertPrefix(prefix);

  let body: string;
  if (sortable) {
    assertLength(length, OKID_SORTABLE_MIN_LENGTH, "length");
    // Time ordering requires lexicographic encoding, which requires the full
    // codepoint-ordered alphabet — partial subsets cannot preserve both the
    // caller's charset choice AND cross-ms ordering, so toggles are ignored.
    const alphabet = resolveAlphabet(true, true, true, true, true);
    body = encodeTimestamp(Date.now()) + encodeAlphabet(alphabet, length - 8);
  } else {
    assertLength(length, OKID_MIN_LENGTH, "length");
    body = encodeAlphabet(
      resolveAlphabet(numbers, lowercase, uppercase, symbols, lookAlikes),
      length,
    );
  }

  return prefix ? prefix + body : body;
}
