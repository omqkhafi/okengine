/**
 * Attenuation — a derived principal can never exceed its creator.
 *
 * Applies to API keys and `invoke-as` exactly the same way.
 *
 * @see docs/spec/console.md §3.3 · §10.4
 */

/** Result of an attenuation check. */
export interface AttenuationResult {
  readonly ok: boolean;
  /** Scopes the creator lacks (empty when ok). */
  readonly excess: readonly string[];
}

/**
 * Whether `requested` is a subset of `creator` scopes.
 *
 * @param creatorScopes - Creator's Module:Action set
 * @param requestedScopes - Requested scopes for the derived principal
 */
export function attenuateScopes(
  creatorScopes: ReadonlySet<string> | Iterable<string>,
  requestedScopes: Iterable<string>,
): AttenuationResult {
  const creator =
    creatorScopes instanceof Set ? creatorScopes : new Set(creatorScopes);
  const excess: string[] = [];
  for (const scope of requestedScopes) {
    if (!creator.has(scope)) excess.push(scope);
  }
  return { ok: excess.length === 0, excess };
}

/**
 * Assert attenuation; throw when the key/invoke-as would escalate.
 *
 * @param creatorScopes - Creator scopes
 * @param requestedScopes - Requested scopes
 * @param label - Error label (`api key` / `invoke-as`)
 */
export function assertAttenuated(
  creatorScopes: ReadonlySet<string> | Iterable<string>,
  requestedScopes: Iterable<string>,
  label = "principal",
): void {
  const result = attenuateScopes(creatorScopes, requestedScopes);
  if (!result.ok) {
    throw new AttenuationError(
      `${label} cannot exceed creator scopes; missing: ${result.excess.join(", ")}`,
      result.excess,
    );
  }
}

/** Privilege-escalation attempt via key or invoke-as. */
export class AttenuationError extends Error {
  readonly excess: readonly string[];

  /**
   * @param message - Diagnostic
   * @param excess - Scopes the creator lacks
   */
  constructor(message: string, excess: readonly string[]) {
    super(message);
    this.name = "AttenuationError";
    this.excess = excess;
  }
}
