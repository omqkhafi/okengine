/**
 * Boot honesty lines (`oke boot: …`) — once per process, suppressible in
 * the `oke dev` Backend child so the parent Console owns the notice.
 */

/**
 * Emit a boot warning unless suppressed for this process.
 *
 * Set `OKE_SUPPRESS_BOOT_WARN=1` on the Backend child during `oke dev` so
 * Signal / Channel / files process-local notices print once (parent only).
 *
 * @param message - Full warning text (usually prefixed `oke boot:`)
 */
export function emitBootWarn(message: string): void {
  if (process.env["OKE_SUPPRESS_BOOT_WARN"] === "1") return;
  console.warn(message);
}
