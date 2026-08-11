/**
 * Declared flow errors — typed error union from Manifest.
 */

import type { JSX } from "react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { FlowErrors } from "../../../../../../manifest/types.ts";
import { fieldsFromSchema, schemaObject } from "../lib/fields-from-schema.ts";
import { SchemaFields } from "./schema-fields.tsx";

/** Props for {@link ErrorsSection}. */
export interface ErrorsSectionProps {
  readonly errors: FlowErrors | undefined;
}

/**
 * Errors section — one alert card per declared code.
 *
 * @param props - Manifest flow.errors
 */
export function ErrorsSection({ errors }: ErrorsSectionProps): JSX.Element | null {
  if (!errors) return null;

  const entries: Array<{ code: string; schema: Record<string, unknown> | null }> = Array.isArray(
    errors,
  )
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
        <span className="ml-1.5 font-normal tabular-nums normal-case tracking-normal">
          {entries.length}
        </span>
      </h3>
      <p className="text-[11px] text-muted-foreground">
        Typed error union returned as {"{ code, data }"} — not HTTP status docs.
      </p>
      <ul className="flex flex-col gap-1.5">
        {entries.map((e) => (
          <li
            key={e.code}
            className="relative overflow-hidden rounded-md border border-destructive/25 bg-destructive/[0.04] px-2.5 py-2"
            data-slot="error-code"
            data-code={e.code}
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-destructive/70" />
            <div className="flex items-center gap-1.5">
              <HugeiconsIcon
                icon={Alert02Icon}
                className="size-3.5 shrink-0 text-destructive"
                aria-hidden
              />
              <p className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold text-foreground/90">
                {e.code}
              </p>
            </div>
            {e.schema ? (
              <div className="mt-1.5 border-t border-destructive/15 pt-1 pl-5">
                <SchemaFields fields={fieldsFromSchema(e.schema)} emptyLabel="No payload fields." />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
