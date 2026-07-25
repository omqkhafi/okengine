/**
 * Recipient display helpers — server already masks; UI never invents cleartext.
 */

/**
 * Whether a displayed recipient looks masked.
 *
 * @param toMasked - Display string from the server
 */
export function looksMasked(toMasked: string): boolean {
  return toMasked.includes("***") || toMasked === "[redacted]";
}
