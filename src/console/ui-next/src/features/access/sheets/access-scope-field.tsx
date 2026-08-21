/**
 * Multi-select grantable scopes — grouped by Module:Action prefix.
 */

import { useEffect, useMemo, useState, type JSX } from "react";
import { cn } from "@/lib/utils.ts";
import { groupAccessScopes } from "../lib/scope-groups.ts";
import { AccessSheetSearch } from "./access-sheet-search.tsx";

/** Props for {@link AccessScopeField}. */
export interface AccessScopeFieldProps {
  readonly scopes: readonly string[];
  readonly selected: readonly string[];
  readonly empty: string;
  readonly onChange: (scopes: readonly string[]) => void;
}

/**
 * Toggle chips for grantable scopes, one band per module.
 *
 * @param props - Catalog + selection
 */
export function AccessScopeField({
  scopes,
  selected,
  empty,
  onChange,
}: AccessScopeFieldProps): JSX.Element {
  const [query, setQuery] = useState("");
  const chosen = new Set(selected);
  const visible = useMemo(() => filterScopes(scopes, query), [scopes, query]);
  const groups = useMemo(() => groupAccessScopes(visible), [visible]);

  const catalogKey = scopes.join("\0");
  useEffect(() => {
    setQuery("");
  }, [catalogKey]);

  return (
    <div className="border-b border-border/50" data-slot="access-scope-field">
      <div className="flex items-stretch">
        <p className="flex h-8 w-[5.5rem] shrink-0 items-center px-4 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Scopes
        </p>
        {scopes.length > 0 ? (
          <AccessSheetSearch
            value={query}
            placeholder="Search scopes"
            label="Search scopes"
            onChange={setQuery}
          />
        ) : null}
      </div>
      {scopes.length === 0 ? (
        <p className="border-t border-border/50 px-4 py-3 text-[11px] text-muted-foreground">
          {empty}
        </p>
      ) : visible.length === 0 ? (
        <p className="border-t border-border/50 px-4 py-3 text-[11px] text-muted-foreground">
          No scopes match.
        </p>
      ) : (
        <div className="max-h-56 overflow-y-auto" role="group" aria-label="Scopes">
          {groups.map((band) => (
            <div
              key={band.group}
              className="flex items-stretch border-t border-border/50"
              role="group"
              aria-label={band.group}
            >
              <p className="flex w-[5.5rem] shrink-0 items-center px-4 font-mono text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {band.group}
              </p>
              <div className="flex min-w-0 flex-1 flex-wrap items-stretch">
                {band.items.map((item) => {
                  const on = chosen.has(item.scope);
                  return (
                    <button
                      key={item.scope}
                      type="button"
                      aria-pressed={on}
                      aria-label={item.scope}
                      data-slot="access-scope-chip"
                      title={item.scope}
                      onClick={() => {
                        onChange(
                          on ? selected.filter((s) => s !== item.scope) : [...selected, item.scope],
                        );
                      }}
                      className={cn(
                        "inline-flex h-8 min-w-0 items-center px-2 font-mono text-[10px] font-semibold outline-none select-none",
                        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                        on
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {item.action}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function filterScopes(scopes: readonly string[], query: string): readonly string[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return scopes;
  return scopes.filter((scope) => scope.toLowerCase().includes(q));
}
