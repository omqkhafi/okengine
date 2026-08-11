/**
 * Schema field rows — "fileKey string" style type list.
 */

import type { JSX } from "react";
import type { FormField } from "../lib/fields-from-schema.ts";

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
    <ul className="flex flex-col gap-0.5" data-slot="schema-fields">
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
  const typeLabel =
    field.type === "enum" && field.enumValues
      ? field.enumValues.join(" | ")
      : field.type;
  return (
    <li>
      <div
        className="flex items-baseline gap-2 py-0.5 font-mono text-[11px]"
        style={{ paddingLeft: depth * 12 }}
      >
        <span className="text-foreground/90">
          {field.name}
          {field.required ? "" : "?"}
        </span>
        <span className="text-muted-foreground">{typeLabel}</span>
      </div>
      {field.children?.map((c) => (
        <SchemaFieldRow key={c.path} field={c} depth={depth + 1} />
      ))}
    </li>
  );
}
