/**
 * ERD cardinality marks — crow's foot / bars / loop.
 *
 * Hugeicons has no relation-cardinality set; these are the standard
 * database marks used on schema edges, cards, and the legend.
 */

import type { JSX } from "react";
import { cn } from "@/lib/utils.ts";
import type { SchemaRelationKind } from "../lib/schema-graph.ts";

/** Props for {@link SchemaRelationIcon}. */
export interface SchemaRelationIconProps {
  readonly kind: SchemaRelationKind;
  readonly className?: string;
  readonly hex?: string;
}

const RELATION_LABEL = {
  "many-to-one": "Many-to-one",
  "one-to-one": "One-to-one",
  "many-to-many": "Many-to-many",
  self: "Self",
} as const;

/**
 * One cardinality mark for a foreign-key relation.
 *
 * @param props - Kind + optional edge color
 */
export function SchemaRelationIcon({ kind, className, hex }: SchemaRelationIconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-3.5 shrink-0", !hex && "text-muted-foreground", className)}
      style={hex ? { color: hex } : undefined}
      aria-label={RELATION_LABEL[kind]}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <RelationPaths kind={kind} />
    </svg>
  );
}

function RelationPaths({ kind }: { readonly kind: SchemaRelationKind }): JSX.Element {
  if (kind === "one-to-one") {
    return (
      <>
        <path d="M6 7 V17" />
        <path d="M6 12 H18" />
        <path d="M18 7 V17" />
      </>
    );
  }
  if (kind === "many-to-many") {
    return (
      <>
        <path d="M3 6 L10 12 L3 18" />
        <path d="M10 12 H14" />
        <path d="M21 6 L14 12 L21 18" />
      </>
    );
  }
  if (kind === "self") {
    return (
      <>
        <path d="M8 16.5 A5.5 5.5 0 1 1 16.5 16.2" />
        <path d="M14.2 13.6 L16.5 16.4 L18.9 13.7" />
      </>
    );
  }
  return (
    <>
      <path d="M3 6 L10 12 L3 18" />
      <path d="M10 12 H16" />
      <path d="M16 7 V17" />
      <path d="M16 12 H21" />
    </>
  );
}
