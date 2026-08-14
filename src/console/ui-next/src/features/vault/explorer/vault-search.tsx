/**
 * Deep vault search — operators + live suggestions.
 */

import { useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { ExplorerSearch } from "@/components/explorer/explorer-search.tsx";
import { cn } from "@/lib/utils.ts";
import {
  applySearchSuggestion,
  vaultSearchSuggestions,
  type VaultSearchSuggestion,
} from "../lib/search.ts";
import type { VaultRecord } from "../lib/types.ts";

/** Props for {@link VaultSearch}. */
export interface VaultSearchProps {
  readonly query: string;
  readonly secrets: readonly VaultRecord[];
  readonly onQueryChange: (query: string) => void;
}

/**
 * Command-style search with operator autocomplete.
 *
 * @param props - Query + catalog
 */
export function VaultSearch({ query, secrets, onQueryChange }: VaultSearchProps): JSX.Element {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const suggestions = useMemo(() => vaultSearchSuggestions(query, secrets), [query, secrets]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const apply = (item: VaultSearchSuggestion) => {
    onQueryChange(applySearchSuggestion(query, item.token));
    setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || suggestions.length === 0) {
      if (event.key === "ArrowDown" && suggestions.length > 0) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === "Enter" && suggestions[active]) {
      event.preventDefault();
      apply(suggestions[active]);
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1" data-slot="vault-search">
      <ExplorerSearch
        data-slot="vault-search-input"
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search vault…"
        aria-label="Search vault"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        role="combobox"
        title="name, fingerprint, reader…  is:unset  from:.env.local"
      />
      {open && suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full z-30 mt-1 max-h-72 w-[min(20rem,calc(100vw-4rem))] overflow-y-auto rounded-lg border border-border/70 bg-popover p-1 shadow-md"
        >
          {suggestions.map((item, index) => (
            <li key={`${item.token}-${index}`} role="option" aria-selected={index === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => apply(item)}
                className={cn(
                  "flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left",
                  index === active && "bg-muted/70",
                )}
              >
                <span className="font-mono text-[11px] text-foreground">{item.token}</span>
                <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                  {item.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
