/**
 * Shared Advanced disclosure and template strip for Store catalog create sheets.
 */

import { FilterHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { JSX } from "react";
import { SheetChoice, SheetChoiceRow, SheetTextToggle } from "@/components/ui/sheet-form.tsx";

/** Starter card the catalog create sheets can flatten into a strip. */
export type CatalogTemplate = {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
};

/** Props for {@link CatalogAdvancedToggle}. */
export interface CatalogAdvancedToggleProps {
  readonly open: boolean;
  readonly extraCount?: number;
  readonly onOpenChange: (open: boolean) => void;
  readonly controls: string;
}

/**
 * Advanced toggle — same flat text control as Create policy Gate.
 *
 * @param props - Open state + optional extra count
 */
export function CatalogAdvancedToggle({
  open,
  extraCount = 0,
  onOpenChange,
  controls,
}: CatalogAdvancedToggleProps): JSX.Element {
  return (
    <SheetTextToggle
      active={open || extraCount > 0}
      extraCount={extraCount}
      aria-expanded={open}
      aria-controls={controls}
      onClick={() => onOpenChange(!open)}
    >
      <HugeiconsIcon icon={FilterHorizontalIcon} className="size-3" aria-hidden />
      Advanced
    </SheetTextToggle>
  );
}

/** Props for {@link CatalogTemplateStrip}. */
export interface CatalogTemplateStripProps<T extends CatalogTemplate> {
  readonly templates: readonly T[];
  readonly selectedId: string | null;
  readonly onSelect: (tpl: T) => void;
}

/**
 * One-row starters — title chips plus the selected detail.
 *
 * @param props - Templates + current pick
 */
export function CatalogTemplateStrip<T extends CatalogTemplate>({
  templates,
  selectedId,
  onSelect,
}: CatalogTemplateStripProps<T>): JSX.Element {
  const selected = templates.find((tpl) => tpl.id === selectedId) ?? null;
  return (
    <SheetChoiceRow
      label="Templates"
      hint={selected?.detail ?? "Pick a starter, or fill the fields."}
    >
      {templates.map((tpl) => (
        <SheetChoice key={tpl.id} active={tpl.id === selectedId} onClick={() => onSelect(tpl)}>
          {tpl.title}
        </SheetChoice>
      ))}
    </SheetChoiceRow>
  );
}
