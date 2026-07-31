/**
 * Pluggable password breach check — optional Have I Been Pwned k-anonymity helper.
 *
 * HIBP Pwned Passwords range API (no API key):
 * `GET https://api.pwnedpasswords.com/range/{5-char-SHA1-prefix}`
 * with required `User-Agent`. Client matches the remaining suffix locally.
 */

/** Returns `true` when the password should be rejected as breached. */
export type BreachCheckFn = (password: string) => Promise<boolean>;

/** Behaviour when the breach-check network call fails. */
export type BreachCheckErrorMode = "reject" | "allow";

/** Options for {@link createHibpBreachCheck}. */
export interface HibpBreachCheckOptions {
  /** Required identifying User-Agent (HIBP terms). */
  readonly userAgent: string;
  /** Injectable fetch (tests). Defaults to global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Send `Add-Padding: true` (recommended). Default true. */
  readonly padding?: boolean;
  /**
   * When the range API errors / is unreachable.
   * Default `"reject"` (fail closed while breach check is enabled).
   */
  readonly onError?: BreachCheckErrorMode;
}

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";

/**
 * SHA-1 hex digest of a UTF-8 string (uppercase).
 *
 * @param password - Plaintext
 */
export async function sha1HexUpper(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Create a Have I Been Pwned k-anonymity breach checker.
 *
 * Never sends the password or full hash — only the first 5 hex chars of SHA-1.
 *
 * @param options - User-Agent and fetch knobs
 */
export function createHibpBreachCheck(options: HibpBreachCheckOptions): BreachCheckFn {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const onError = options.onError ?? "reject";
  const padding = options.padding !== false;

  return async (password) => {
    const full = await sha1HexUpper(password);
    const prefix = full.slice(0, 5);
    const suffix = full.slice(5);
    try {
      const res = await fetchFn(`${HIBP_RANGE_URL}${prefix}`, {
        headers: {
          "User-Agent": options.userAgent,
          ...(padding ? { "Add-Padding": "true" } : {}),
        },
      });
      if (!res.ok) {
        if (onError === "allow") return false;
        throw new BreachCheckError(`HIBP range HTTP ${res.status}`);
      }
      const body = await res.text();
      for (const line of body.split("\n")) {
        const [hashSuffix, countStr] = line.trim().split(":");
        if (!hashSuffix || hashSuffix.length === 0) continue;
        const count = Number(countStr ?? "0");
        // Padded rows always have count 0 — discard.
        if (count === 0) continue;
        if (hashSuffix.toUpperCase() === suffix) return true;
      }
      return false;
    } catch (err) {
      if (err instanceof BreachCheckError) throw err;
      if (onError === "allow") return false;
      throw new BreachCheckError(err instanceof Error ? err.message : "HIBP range request failed");
    }
  };
}

/**
 * Run an optional breach check. No-op when `check` is omitted.
 *
 * @param password - Plaintext
 * @param check - Pluggable checker (`true` = breached)
 */
export async function assertNotBreached(
  password: string,
  check: BreachCheckFn | undefined,
): Promise<void> {
  if (!check) return;
  const breached = await check(password);
  if (breached) throw new BreachCheckError("password appears in a known breach");
}

/** Breach check rejected the password or failed closed. */
export class BreachCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BreachCheckError";
  }
}
