/**
 * Schema validation briefing — ranges and labeled options.
 */

import type { JSX } from "react";
import { SectionHead } from "@/components/explorer/section-head.tsx";
import {
  fieldRangeSentence,
  fieldsWithValidation,
  type FormField,
} from "../lib/fields-from-schema.ts";

/** Props for {@link ValidationSection}. */
export interface ValidationSectionProps {
  readonly fields: readonly FormField[];
}

/**
 * Explains min/max and what each allowed option means.
 *
 * @param props - Request / input fields
 */
export function ValidationSection({ fields }: ValidationSectionProps): JSX.Element | null {
  const entries = fieldsWithValidation(fields);
  if (entries.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" data-slot="validation-section" aria-label="Validation">
      <SectionHead title="Validation" meta={String(entries.length)} />
      <ul className="flex flex-col gap-3">
        {entries.map((field) => (
          <ValidationField key={field.path} field={field} />
        ))}
      </ul>
    </section>
  );
}

function ValidationField({ field }: { readonly field: FormField }): JSX.Element {
  const range = fieldRangeSentence(field);
  const options = field.valueMeanings?.length
    ? field.valueMeanings
    : field.enumValues?.map((value) => ({ value, label: value }));
  return (
    <li className="flex flex-col gap-1.5" data-slot="validation-field" data-field={field.name}>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11px] font-medium text-foreground/90">{field.name}</span>
        {range ? <span className="text-[11px] text-muted-foreground">{range}</span> : null}
      </div>
      {options && options.length > 0 ? (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-5">
          {options.map((opt) => (
            <li
              key={opt.value}
              className="flex min-w-0 items-baseline gap-1.5 font-mono text-[11px]"
              data-slot="validation-option"
            >
              <span className="shrink-0 text-muted-foreground">{opt.value}</span>
              <span className="truncate text-foreground/90">{opt.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
