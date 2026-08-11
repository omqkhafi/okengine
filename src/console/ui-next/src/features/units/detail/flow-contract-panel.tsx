/**
 * Units contract detail — trigger-aware header + schemas + errors + gates + effects.
 */

import type { JSX } from "react";
import { Radio01Icon, SecurityCheckIcon, Timer01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Manifest, Signal } from "../../../../../../manifest/types.ts";
import { GateList } from "@/components/gate-list";
import { HttpMethodBadge } from "@/components/http-method-badge";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { callersOfFlow } from "@/features/flows/graph/build-flow-graph.ts";
import { traceGateInfos } from "@/features/flows/traces/trace-gates.ts";
import { traceRequestMeta } from "@/features/flows/traces/request-meta.ts";
import type { UnitFlowRow } from "../lib/unit-tree.ts";
import { fieldsFromSchema, schemaObject } from "../lib/fields-from-schema.ts";
import { flowTriggerKind, flowTriggerSpec } from "../lib/flow-trigger.ts";
import { resolveClockForFlow } from "../lib/resolve-clock.ts";
import { EffectsSummary } from "./effects-summary.tsx";
import { ErrorsSection } from "./errors-section.tsx";
import { SchemaFields } from "./schema-fields.tsx";

/** Props for {@link FlowContractPanel}. */
export interface FlowContractPanelProps {
  readonly row: UnitFlowRow;
  readonly manifest: Manifest | null;
}

const sectionClassName = "flex flex-col gap-2";

/**
 * Top detail pane for a selected flow.
 *
 * @param props - Flow row + Manifest
 */
export function FlowContractPanel({ row, manifest }: FlowContractPanelProps): JSX.Element {
  const kind = flowTriggerKind(row.flow.trigger);
  const trigger = flowTriggerSpec(row.flow.trigger);
  const meta = traceRequestMeta(
    manifest,
    row.id,
    kind === "http" ? "http" : kind === "internal" ? "internal" : kind,
  );
  const inSchema = schemaObject(row.flow.in);
  const outSchema = schemaObject(row.flow.out);
  const gates = traceGateInfos(row.flow.gates ?? [], manifest);
  const signalDecl: Signal | undefined =
    kind === "signal" && row.flow.trigger?.signal
      ? manifest?.signals?.[row.flow.trigger.signal]
      : undefined;
  const clockMatch =
    kind === "cron" || kind === "every" ? resolveClockForFlow(manifest, row.id) : null;
  const callers = kind === "internal" ? callersOfFlow(manifest, row.id) : [];
  const inputLabel = kind === "http" ? "Request" : "Input";
  const outputLabel = kind === "http" ? "Response" : "Output";

  return (
    <div className="flex flex-col gap-5 p-4" data-slot="flow-contract-panel" data-trigger={kind}>
      <header className="flex flex-col gap-2.5" data-slot="endpoint-header">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/30 text-foreground"
            title={trigger.detail ? `${trigger.label} · ${trigger.detail}` : trigger.label}
            aria-hidden
            data-slot="trigger-kind-icon"
            data-kind={kind}
          >
            <HugeiconsIcon icon={trigger.icon} className="size-3.5" />
          </span>
          <h2 className="min-w-0 flex-1 truncate font-mono text-base font-semibold tracking-tight text-foreground">
            {row.id}
          </h2>
          <Badge
            variant="outline"
            className="h-5 shrink-0 px-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
            data-slot="trigger-kind-badge"
          >
            {trigger.label}
          </Badge>
        </div>

        {kind === "http" && meta.method && meta.path ? (
          <div className="flex min-w-0 items-center gap-2" data-slot="http-endpoint-line">
            <HttpMethodBadge method={meta.method} />
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground select-all">
              {meta.path}
            </code>
          </div>
        ) : (
          <div className="flex flex-col gap-1" data-slot="trigger-headline">
            <p className="font-mono text-xs text-muted-foreground">{meta.headline}</p>
            {kind === "signal" && signalDecl ? (
              <p className="text-[11px] text-muted-foreground" data-slot="signal-delivery">
                Delivery · {signalDecl.delivery}
                {signalDecl.retries !== undefined ? ` · retries ${signalDecl.retries}` : ""}
                {signalDecl.deadLetter ? " · dead-letter" : ""}
              </p>
            ) : null}
            {(kind === "cron" || kind === "every") && clockMatch?.kind === "matched" ? (
              <p className="text-[11px] text-muted-foreground" data-slot="clock-join">
                Clock · <span className="font-mono">{clockMatch.clockName}</span>
                {clockMatch.timezone ? ` · ${clockMatch.timezone}` : ""}
              </p>
            ) : null}
            {kind === "internal" ? (
              <p className="text-[11px] text-muted-foreground" data-slot="call-only-note">
                No external trigger — reachable via <code className="font-mono">effects.calls</code>{" "}
                / <code className="font-mono">fx.call</code>.
              </p>
            ) : null}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {row.flow.plane ? <PlaneBadge plane={row.flow.plane} /> : null}
          {row.flow.durable ? (
            <MetaPill
              icon={Timer01Icon}
              label="durable"
              title="Durable — long-running, retryable steps"
            />
          ) : null}
          {row.flow.live ? (
            <MetaPill
              icon={Radio01Icon}
              label="live"
              title="Live — subscribes to realtime updates"
            />
          ) : null}
        </div>

        {kind === "internal" ? (
          <section className="flex flex-col gap-1.5" aria-label="Callers" data-slot="callers-list">
            <h3 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Called by
            </h3>
            {callers.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No Manifest caller declares <code className="font-mono">effects.calls</code> for
                this flow.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {callers.map((id) => (
                  <li key={id} className="font-mono text-xs text-foreground/90">
                    {id}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </header>

      {kind === "cron" || kind === "every" ? null : (
        <section className={sectionClassName} aria-label={inputLabel}>
          <SectionHeading>{inputLabel}</SectionHeading>
          <SchemaFields
            fields={fieldsFromSchema(inSchema)}
            emptyLabel={
              typeof row.flow.in === "string"
                ? "Schema not expanded in Manifest."
                : kind === "signal"
                  ? "No flow input schema — signal payload shape lives on the signal when declared."
                  : "No input schema declared."
            }
          />
        </section>
      )}

      <section className={sectionClassName} aria-label={outputLabel}>
        <SectionHeading>{outputLabel}</SectionHeading>
        <SchemaFields
          fields={fieldsFromSchema(outSchema)}
          emptyLabel={
            typeof row.flow.out === "string"
              ? "Schema not expanded in Manifest."
              : "No output schema declared."
          }
        />
      </section>

      <ErrorsSection errors={row.flow.errors} />
      <GateList gates={gates} />
      <EffectsSummary effects={row.flow.effects} />
    </div>
  );
}

/**
 * Uppercase section eyebrow — shared rhythm with TraceDetailSheet sections.
 *
 * @param props - Label text
 */
function SectionHeading({ children }: { readonly children: string }): JSX.Element {
  return (
    <h3 className="border-b border-border/50 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

/**
 * Plane badge — `user` (application identity) vs `operator` (Console).
 *
 * @param props - Manifest flow.plane
 */
function PlaneBadge({ plane }: { readonly plane: string }): JSX.Element {
  const operator = plane === "operator";
  const icon = operator ? SecurityCheckIcon : UserIcon;
  const label = operator ? "operator" : "user";
  const tip = operator
    ? "Operator plane — runs under a Console operator identity, not an application user."
    : "User plane — runs under an application user identity (invoke-as).";
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span {...props} className="inline-flex">
            <Badge
              variant="outline"
              className="h-5 cursor-help gap-1 border-foreground/20 px-1.5 text-[10px] font-medium"
              data-slot="plane-badge"
              data-plane={plane}
            >
              <HugeiconsIcon icon={icon} className="size-3" aria-hidden />
              {label}
            </Badge>
          </span>
        )}
      />
      <TooltipContent side="bottom" className="max-w-xs text-[11px]">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Small flagged-capability pill (durable / live) with a tooltip.
 *
 * @param props - Icon + label + tooltip text
 */
function MetaPill({
  icon,
  label,
  title,
}: {
  readonly icon: typeof Timer01Icon;
  readonly label: string;
  readonly title: string;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span {...props} className="inline-flex">
            <Badge
              variant="outline"
              className="h-5 cursor-help gap-1 px-1.5 text-[10px] font-medium text-muted-foreground"
            >
              <HugeiconsIcon icon={icon} className="size-3" aria-hidden />
              {label}
            </Badge>
          </span>
        )}
      />
      <TooltipContent side="bottom" className="max-w-xs text-[11px]">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}
