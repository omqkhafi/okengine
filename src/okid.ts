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
 *   millisecond tie on the timestamp and carry no intra-ms ordering. Clock skew
 *   distorts ordering but can never cause duplicates (the tail stays random).
 * - **Semantic prefix** — `okid({ prefix: "usr_" })` prepends a fixed label
 *   from the OKID alphabet. `length` is always the generated body (random or
 *   sortable); the returned string is `prefix + body`.
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
 * const eventKey = okid({ sortable: true });   // time-prefixed body
 * const typedId = okid({ prefix: "usr_" });    // usr_ + 21-char body
 * const inviteCode = okid({
 *   lookAlikes: false,
 *   uppercase: false,
 * });                                          // human-transcribable
 * ```
 *
 * @module
 */

import { lazyRequire } from "./kernel/lazy-require.ts";
import {
  assertLength,
  OKID_DEFAULT_CHARS,
  OKID_DEFAULT_LENGTH,
  OKID_MIN_LENGTH,
  type OkidOptions,
} from "./okid-shared.ts";

export type { OkidOptions } from "./okid-shared.ts";
export {
  OKID_ALPHABET,
  OKID_DEFAULT_LENGTH,
  OKID_LOOKALIKE_CHARS,
  OKID_MAX_LENGTH,
  OKID_MAX_PREFIX_LENGTH,
  OKID_MIN_LENGTH,
  OKID_SORTABLE_ALPHABET,
  OKID_SORTABLE_MIN_LENGTH,
} from "./okid-shared.ts";

/**
 * Load sortable / prefix / alphabet-toggle encoding.
 * Computed stem so the edge profile does not inline it.
 */
function loadOkidExtended(): typeof import("./okid-extended.ts") {
  return lazyRequire(import.meta.dir, ["okid", "extended"].join("-"));
}

/**
 * Generate an OKE-native id.
 *
 * Accepts either a bare length or an options object; the bare-number form is
 * the hot path and skips all option resolution beyond validation.
 *
 * @param options - Length in chars, or {@link OkidOptions}
 * @returns A URL-safe id: the generated body, optionally preceded by
 * {@link OkidOptions.prefix}
 * @throws RangeError on invalid input (non-integer, out-of-range length,
 * invalid prefix, empty alphabet)
 */
export function okid(options: number | OkidOptions = OKID_DEFAULT_LENGTH): string {
  if (typeof options === "number") {
    assertLength(options, OKID_MIN_LENGTH, "length");
    const bytes = new Uint8Array(options);
    crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < options; i++) out += OKID_DEFAULT_CHARS[bytes[i]! & 63]!;
    return out;
  }
  return loadOkidExtended().okidWithOptions(options);
}
