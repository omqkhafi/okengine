/**
 * Schema field type → badge visual tokens.
 *
 * Colors mirror the TraceDetailSheet payload value tones (string → rose,
 * number → amber, boolean → emerald) so one type reads the same everywhere
 * the product renders JSON-ish fields. Object/array/enum/unknown are neutral.
 */

/** Badge foreground/background/border classes for a schema field type. */
export function schemaTypeBadgeClass(type: string): string {
  switch (type) {
    case "string":
      return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
    case "number":
    case "integer":
      return "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300";
    case "boolean":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "enum":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400";
    case "object":
    case "array":
      return "border-border/70 bg-muted/40 text-muted-foreground";
    default:
      return "border-border/70 bg-muted/40 text-muted-foreground";
  }
}
