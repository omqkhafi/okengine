/**
 * Declared flow errors — typed error union from Manifest.
 */

import type { JSX } from "react";
import type { FlowErrors } from "../../../../../../manifest/types.ts";
import { fieldsFromSchema, schemaObject } from "../lib/fields-from-schema.ts";
import { SchemaFields } from "./schema-fields.tsx";

/** Props for {@link ErrorsSection}. */
export interface ErrorsSectionProps {
  readonly errors: FlowErrors | undefined;
}

/**
 * Errors section — codes + optional payload schemas.
 *
 * @param props - Manifest flow.errors
 */
export function ErrorsSection({ errors }: ErrorsSectionProps): JSX.Element | null {
  if (!errors) return null;

  const entries: Array<{ code: string; schema: Record<string, unknown> | null }> =
    Array.isArray(errors)
      ? errors.map((code) => ({ code, schema: null }))
      : Object.entries(errors).map(([code, schema]) => ({
          code,
          schema: schemaObject(schema),
        }));

  if (entries.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" data-slot="errors-section" aria-label="Errors">
      <h3 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        Errors
      </h3>
      <p className="text-[11px] text-muted-foreground">
        Typed error union returned as {"{ code, data }"} — not HTTP status docs.
      </p>
      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <li
            key={e.code}
            className="rounded-md border border-border/60 px-2 py-1.5"
            data-slot="error-code"
            data-code={e.code}
          >
            <p className="font-mono text-[11px] font-medium text-foreground/90">{e.code}</p>
            {e.schema ? (
              <div className="mt-1">
                <SchemaFields fields={fieldsFromSchema(e.schema)} emptyLabel="No payload fields." />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
