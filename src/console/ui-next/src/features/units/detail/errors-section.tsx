/**
 * Declared flow errors + derived platform failure modes (Units contract).
 */

import type { JSX } from "react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Flow, FlowErrors, Manifest } from "../../../../../../manifest/types.ts";
import { fieldsFromSchema, schemaObject } from "../lib/fields-from-schema.ts";
import { platformFailureModes, type PlatformFailureMode } from "../lib/platform-failure-modes.ts";
import { SchemaFields } from "./schema-fields.tsx";

/** Props for {@link ErrorsSection}. */
export interface ErrorsSectionProps {
  readonly errors: FlowErrors | undefined;
  /** Flow row — gates + input schema for platform modes. */
  readonly flow: Pick<Flow, "gates" | "in">;
  readonly manifest: Manifest | null;
}

/**
 * Two-tier errors: declared Flow errors + platform modes from this flow's
 * own gates/schema (HTTP-encoding truth).
 *
 * @param props - Manifest errors + flow + manifest
 */
export function ErrorsSection({ errors, flow, manifest }: ErrorsSectionProps): JSX.Element | null {
  const flowEntries = flowErrorEntries(errors);
  const platform = platformFailureModes(flow, manifest);
  if (flowEntries.length === 0 && platform.length === 0) return null;

  return (
    <div className="flex flex-col gap-5" data-slot="errors-tier">
      {flowEntries.length > 0 ? <FlowErrorsBlock entries={flowEntries} /> : null}
      {platform.length > 0 ? <PlatformFailureModesBlock modes={platform} /> : null}
    </div>
  );
}

type FlowErrorEntry = { readonly code: string; readonly schema: Record<string, unknown> | null };

function flowErrorEntries(errors: FlowErrors | undefined): FlowErrorEntry[] {
  if (!errors) return [];
  const entries: FlowErrorEntry[] = Array.isArray(errors)
    ? errors.map((code) => ({ code, schema: null }))
    : Object.entries(errors).map(([code, schema]) => ({
        code,
        schema: schemaObject(schema),
      }));
  return entries;
}

/**
 * Declared business error union — unchanged framing.
 *
 * @param props - Parsed error entries
 */
function FlowErrorsBlock({
  entries,
}: {
  readonly entries: readonly FlowErrorEntry[];
}): JSX.Element {
  return (
    <section className="flex flex-col gap-2" data-slot="errors-section" aria-label="Flow errors">
      <h3 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        Flow errors
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

/**
 * Platform failure modes derived from this flow's gates + input schema.
 *
 * @param props - Derived modes
 */
function PlatformFailureModesBlock({
  modes,
}: {
  readonly modes: readonly PlatformFailureMode[];
}): JSX.Element {
  return (
    <section
      className="flex flex-col gap-2"
      data-slot="platform-failure-modes"
      aria-label="Platform failure modes"
    >
      <h3 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        Platform failure modes
        <span className="ml-1.5 font-normal tabular-nums normal-case tracking-normal">
          {modes.length}
        </span>
      </h3>
      <p className="text-[11px] text-muted-foreground">
        Derived from this flow&apos;s Gates and request schema. Statuses are HTTP-encoding truth (
        <code className="font-mono">ValidationError</code> → 422) — not Call API chrome defaults.
      </p>
      <ul className="flex flex-col gap-1.5">
        {modes.map((m) => (
          <li
            key={`${m.code}:${m.gateName ?? m.source}`}
            className="relative overflow-hidden rounded-md border border-border/70 bg-muted/20 px-2.5 py-2"
            data-slot="platform-failure-mode"
            data-code={m.code}
            data-status={m.status}
            data-source={m.source}
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-muted-foreground/40" />
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <p className="font-mono text-[11px] font-semibold text-foreground/90">{m.code}</p>
              <span className="rounded border border-border/80 px-1 py-px font-mono text-[10px] text-muted-foreground tabular-nums">
                HTTP {m.status}
              </span>
              {m.gateName ? (
                <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                  {m.gateName}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{m.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
