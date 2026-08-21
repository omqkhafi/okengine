/**
 * Group Access scopes by Module:Action prefix.
 */

/** One Module:Action (or bare) scope inside a group. */
export interface AccessScopeItem {
  readonly scope: string;
  readonly action: string;
}

/** Scopes that share a module prefix. */
export interface AccessScopeGroup {
  readonly group: string;
  readonly items: readonly AccessScopeItem[];
}

/**
 * Preserve catalog order; same-prefix scopes share a band.
 * `member` and `member:admin` land under `member`. Nested colons
 * (`console:flows:invoke-as`) stay under the first segment.
 *
 * @param scopes - Grantable or current scopes
 */
export function groupAccessScopes(scopes: readonly string[]): readonly AccessScopeGroup[] {
  const order: string[] = [];
  const map = new Map<string, AccessScopeItem[]>();
  for (const scope of scopes) {
    const i = scope.indexOf(":");
    const group = i <= 0 ? scope : scope.slice(0, i);
    const action = i <= 0 ? scope : scope.slice(i + 1);
    const existing = map.get(group);
    if (existing) {
      existing.push({ scope, action });
      continue;
    }
    order.push(group);
    map.set(group, [{ scope, action }]);
  }
  return order.map((group) => ({ group, items: map.get(group) ?? [] }));
}
