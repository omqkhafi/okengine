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
 * Expand held scopes against a catalog — `console:*` covers every
 * `console:…` pair in the catalog (Access · MCP inheritance).
 *
 * @param held - Raw scopes from the principal / session
 * @param catalog - Manifest-derived Module:Action pairs
 */
export function expandHeldScopes(
  held: Iterable<string>,
  catalog: readonly string[],
): Set<string> {
  const out = new Set<string>();
  let star = false;
  for (const s of held) {
    out.add(s);
    if (s === "console:*") star = true;
  }
  if (star) {
    for (const scope of catalog) {
      if (scope.startsWith("console:")) out.add(scope);
    }
  }
  return out;
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
 * Scopes a principal may grant on a plane — intersection of catalog,
 * plane membership, and {@link attenuateScopes} against the expanded
 * ceiling. Impossibility is taught by absence (console §9.14).
 *
 * @param options - Held scopes, catalog, plane predicate
 */
export function grantableScopes(options: {
  readonly held: Iterable<string>;
  readonly catalog: readonly string[];
  readonly planeOf: (scope: string) => "user" | "operator";
  readonly plane: "user" | "operator";
}): string[] {
  const ceiling = expandHeldScopes(options.held, options.catalog);
  return options.catalog
    .filter((scope) => {
      if (options.planeOf(scope) !== options.plane) return false;
      return attenuateScopes(ceiling, [scope]).ok;
    })
    .sort((a, b) => a.localeCompare(b));
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
