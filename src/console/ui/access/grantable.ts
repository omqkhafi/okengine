/**
 * Client-side filter helpers — grantable scopes come from the server
 * (attenuation). The UI never invents a parallel allow-list.
 */

/**
 * Filter a candidate list to scopes present in the grantable set.
 * Used only to present server-provided grantableScopes — never to decide.
 *
 * @param candidates - Optional candidate scopes (defaults to grantable)
 * @param grantable - Server-provided grantable scopes for the plane
 */
export function visibleGrantableScopes(
  grantable: readonly string[],
  candidates?: readonly string[],
): string[] {
  if (!candidates) return [...grantable].sort((a, b) => a.localeCompare(b));
  const allowed = new Set(grantable);
  return candidates.filter((s) => allowed.has(s)).sort((a, b) => a.localeCompare(b));
}

/**
 * Whether a requested scope set is fully covered by grantable.
 *
 * @param requested - Requested scopes
 * @param grantable - Grantable scopes
 */
export function allGrantable(requested: readonly string[], grantable: readonly string[]): boolean {
  const allowed = new Set(grantable);
  return requested.every((s) => allowed.has(s));
}
