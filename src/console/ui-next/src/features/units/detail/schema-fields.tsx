/**
 * Schema field rows — typed badge + optional pill per field.
 */

import type { JSX } from "react";
import { cn } from "@/lib/utils";
import type { FormField } from "../lib/fields-from-schema.ts";
import { schemaTypeBadgeClass } from "../lib/schema-type-visual.ts";

/** Props for {@link SchemaFields}. */
export interface SchemaFieldsProps {
  readonly fields: readonly FormField[];
  readonly emptyLabel?: string;
}

/**
 * Human-readable schema field list.
 *
 * @param props - Fields from {@link fieldsFromSchema}
 */
export function SchemaFields({
  fields,
  emptyLabel = "No schema fields declared.",
}: SchemaFieldsProps): JSX.Element {
  if (fields.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-slot="schema-fields-empty">
        {emptyLabel}
      </p>
    );
  }
  return (
    <ul className="flex flex-col" data-slot="schema-fields">
      {fields.map((f) => (
        <SchemaFieldRow key={f.path} field={f} depth={0} />
      ))}
    </ul>
  );
}

function SchemaFieldRow({
  field,
  depth,
}: {
  readonly field: FormField;
  readonly depth: number;
}): JSX.Element {
  const isEnum = field.type === "enum" && field.enumValues;
  return (
    <li>
      <div
        className="flex items-center gap-2 py-1"
        style={{ paddingLeft: depth * 14 }}
        data-slot="schema-field-row"
      >
        <span className="min-w-0 truncate font-mono text-[11px] font-medium text-foreground/90">
          {field.name}
        </span>
        {!field.required ? (
          <span
            className="shrink-0 rounded border border-border/60 bg-muted/30 px-1 py-px text-[9px] font-medium tracking-wide text-muted-foreground uppercase"
            data-slot="schema-field-optional"
          >
            optional
          </span>
        ) : null}
        <span
          className={cn(
            "ml-auto shrink-0 rounded border px-1.5 py-px font-mono text-[9px] font-medium tracking-wide",
            schemaTypeBadgeClass(field.type),
          )}
          data-slot="schema-field-type"
          title={isEnum ? field.enumValues?.join(" | ") : field.type}
        >
          {field.type}
        </span>
      </div>
      {isEnum ? (
        <div
          className="truncate pb-1 font-mono text-[10px] text-muted-foreground"
          style={{ paddingLeft: depth * 14 }}
        >
          {field.enumValues?.join("  ·  ")}
        </div>
      ) : null}
      {field.children?.map((c) => (
        <SchemaFieldRow key={c.path} field={c} depth={depth + 1} />
      ))}
    </li>
  );
}
