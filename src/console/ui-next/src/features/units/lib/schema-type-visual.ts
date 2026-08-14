/**
 * Schema field type → badge visual tokens.
 *
 * One hue per type so a contract list is scannable. Rose is reserved for
 * risk (sensitive / DELETE) — strings use teal, not rose.
 */

/** Badge foreground/background/border classes for a schema field type. */
export function schemaTypeBadgeClass(type: string): string {
  switch (type) {
    case "string":
      return "border-teal-500/35 bg-teal-500/10 text-teal-800 dark:text-teal-300";
    case "integer":
      return "border-blue-500/35 bg-blue-500/10 text-blue-800 dark:text-blue-300";
    case "number":
      return "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300";
    case "boolean":
      return "border-violet-500/35 bg-violet-500/10 text-violet-800 dark:text-violet-300";
    case "enum":
      return "border-indigo-500/35 bg-indigo-500/10 text-indigo-800 dark:text-indigo-300";
    case "array":
      return "border-cyan-500/35 bg-cyan-500/10 text-cyan-800 dark:text-cyan-300";
    case "object":
      return "border-zinc-500/35 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300";
    default:
      return "border-border/70 bg-muted/40 text-muted-foreground";
  }
}
