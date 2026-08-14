/**
 * Shared PK / FK / unique glyphs for schema cards, rail, and complete.
 */

import { CircleIcon, DiamondIcon, Key01Icon, Link02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { JSX } from "react";
import { cn } from "@/lib/utils.ts";

/** Constraint kind drawn on a column. */
export type SchemaConstraintKind = "pk" | "fk" | "unique" | "none";

/** Props for {@link SchemaConstraintIcon}. */
export interface SchemaConstraintIconProps {
  readonly kind: SchemaConstraintKind;
  readonly className?: string;
  readonly hex?: string;
  readonly inferred?: boolean;
}

/**
 * One constraint glyph (key / link / diamond).
 *
 * @param props - Kind + optional FK color
 */
export function SchemaConstraintIcon({
  kind,
  className,
  hex,
  inferred,
}: SchemaConstraintIconProps): JSX.Element {
  if (kind === "pk") {
    return (
      <HugeiconsIcon
        icon={Key01Icon}
        className={cn("size-3 shrink-0 text-amber-500", className)}
        aria-label="Primary key"
      />
    );
  }
  if (kind === "unique") {
    return (
      <HugeiconsIcon
        icon={DiamondIcon}
        className={cn("size-3 shrink-0 text-violet-500", className)}
        aria-label="Unique"
      />
    );
  }
  if (kind === "none") {
    return (
      <HugeiconsIcon
        icon={CircleIcon}
        className={cn("size-3 shrink-0 text-muted-foreground/35", className)}
        aria-label="No key"
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={Link02Icon}
      className={cn("size-3 shrink-0", !hex && "text-sky-500", className)}
      style={hex ? { color: hex } : undefined}
      aria-label={inferred ? "Inferred foreign key" : "Foreign key"}
    />
  );
}

/**
 * Compact PK / FK / unique cluster for a column row.
 *
 * @param props - Flags + FK color
 */
export function SchemaColumnMarks({
  primaryKey,
  foreignKey,
  unique,
  inferred,
  hex,
  empty = "spacer",
}: {
  readonly primaryKey?: boolean;
  readonly foreignKey?: boolean;
  readonly unique?: boolean;
  readonly inferred?: boolean;
  readonly hex?: string;
  /** When no key applies: align with a spacer, or show the `none` glyph. */
  readonly empty?: "spacer" | "none";
}): JSX.Element {
  const showUnique = unique === true && primaryKey !== true;
  if (!primaryKey && !foreignKey && !showUnique) {
    if (empty === "none") {
      return (
        <span className="inline-flex shrink-0 items-center" title="None">
          <SchemaConstraintIcon kind="none" />
        </span>
      );
    }
    return <span className="inline-flex w-3 shrink-0" aria-hidden />;
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-px">
      {primaryKey ? <SchemaConstraintIcon kind="pk" /> : null}
      {foreignKey ? <SchemaConstraintIcon kind="fk" hex={hex} inferred={inferred} /> : null}
      {showUnique ? <SchemaConstraintIcon kind="unique" /> : null}
    </span>
  );
}
