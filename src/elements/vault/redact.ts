/**
 * Automatic secret redaction for logs and traces.
 */

/** Default mask token (same family as store PII mask). */
export const SECRET_MASK = "[redacted:secret]";

/**
 * Build a redactor that replaces known secret values (and substrings) in
 * strings and deep-clones objects with values scrubbed.
 *
 * @param secrets - Cleartext values currently loaded
 */
export function createSecretRedactor(
  secrets: Iterable<string>,
): {
  /** Redact a free-form string. */
  redactString(input: string): string;
  /** Deep-redact a JSON-like value. */
  redact(value: unknown): unknown;
} {
  const values = [...secrets]
    .filter((v) => v.length > 0)
    .sort((a, b) => b.length - a.length);

  function redactString(input: string): string {
    let out = input;
    for (const v of values) {
      if (out.includes(v)) {
        out = out.split(v).join(SECRET_MASK);
      }
    }
    return out;
  }

  function redact(value: unknown): unknown {
    if (typeof value === "string") return redactString(value);
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(redact);
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = redact(v);
      }
      return out;
    }
    return value;
  }

  return { redactString, redact };
}
