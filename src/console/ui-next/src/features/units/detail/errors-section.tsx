/**
 * Declared flow errors on the Units contract panel.
 */

import type { JSX } from "react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { FlowErrors } from "../../../../../../manifest/types.ts";
import { SectionHead } from "@/components/explorer/section-head.tsx";
import { fieldsFromSchema, schemaObject } from "../lib/fields-from-schema.ts";

/** Props for {@link ErrorsSection}. */
export interface ErrorsSectionProps {
  readonly errors: FlowErrors | undefined;
}

/**
 * Typed error union returned as `{ code, data }` — not HTTP status docs.
 *
 * @param props - Manifest `errors`
 */
export function ErrorsSection({ errors }: ErrorsSectionProps): JSX.Element | null {
  const entries = flowErrorEntries(errors);
  if (entries.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" data-slot="errors-section" aria-label="Flow errors">
      <SectionHead title="Flow errors" meta={String(entries.length)} />
      <ul className="flex flex-wrap gap-1.5">
        {entries.map((e) => {
          const fields = e.schema ? fieldsFromSchema(e.schema) : [];
          const fieldHint = fields.map((f) => f.name).join(", ");
          return (
            <li
              key={e.code}
              className="inline-flex items-center gap-1 rounded-md border border-destructive/25 bg-destructive/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-destructive"
              title={
                fieldHint
                  ? `{ code, data: { ${fieldHint} } }`
                  : "Typed error — { code, data }"
              }
              data-slot="error-code"
              data-code={e.code}
            >
              <HugeiconsIcon icon={Alert02Icon} className="size-3" aria-hidden />
              <span className="text-foreground/90">{e.code}</span>
              {fieldHint ? <span className="text-muted-foreground">{fieldHint}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type FlowErrorEntry = { readonly code: string; readonly schema: Record<string, unknown> | null };

function flowErrorEntries(errors: FlowErrors | undefined): FlowErrorEntry[] {
  if (!errors) return [];
  return Array.isArray(errors)
    ? errors.map((code) => ({ code, schema: null }))
    : Object.entries(errors).map(([code, schema]) => ({
        code,
        schema: schemaObject(schema),
      }));
}
