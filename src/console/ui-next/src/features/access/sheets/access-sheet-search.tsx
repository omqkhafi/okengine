/**
 * Flush search field for Access sheet catalogs (issuer, scopes).
 */

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { JSX } from "react";
import { Input } from "@/components/ui/input";
import { SHEET_SEARCH } from "@/components/ui/sheet-form.tsx";
import { cn } from "@/lib/utils.ts";

/** Props for {@link AccessSheetSearch}. */
export interface AccessSheetSearchProps {
  readonly value: string;
  readonly placeholder: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
}

/**
 * Leading-icon search inside a sheet section header.
 *
 * @param props - Query + labels
 */
export function AccessSheetSearch({
  value,
  placeholder,
  label,
  onChange,
}: AccessSheetSearchProps): JSX.Element {
  return (
    <label className="relative min-w-0 flex-1">
      <HugeiconsIcon
        icon={Search01Icon}
        className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        flat
        className={cn(SHEET_SEARCH)}
      />
    </label>
  );
}
